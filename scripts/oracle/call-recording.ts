import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { ustarEntries } from "./tool-bundle.ts";

// Records the calls the CLI makes to the functions the Rust units replay one by one (`cli-config`, `editor-schemas`
// and `bundle-fetch`). The compiler's sources are read through a load hook that renames each recorded function and
// puts a wrapper under its name, in the module's own scope, so every caller (re-exports included) goes through it.
// Outside a recording the wrapper only forwards the call. Hooks reach modules loaded by Node, not by vitest.

export type RecordedUnit = "cli-config" | "editor-schemas" | "bundle-fetch";

interface RecordedFunction {
  unit: RecordedUnit;
  /** The source file, relative to `packages/`. */
  file: string;
  name: string;
}

export const RECORDED_FUNCTIONS: readonly RecordedFunction[] = [
  { unit: "cli-config", file: "core/cli/src/config/read-app-config.ts", name: "readAppConfig" },
  { unit: "cli-config", file: "core/cli/src/config/read-root-config.ts", name: "readRootConfig" },
  {
    unit: "cli-config",
    file: "core/cli/src/config/read-workspace-configs.ts",
    name: "readWorkspaceConfigs",
  },
  { unit: "cli-config", file: "core/cli/src/config/read-run-config.ts", name: "readRunConfig" },
  {
    unit: "editor-schemas",
    file: "core/cli/src/editor-schemas/editor-names.ts",
    name: "editorDeclarations",
  },
  {
    unit: "editor-schemas",
    file: "core/cli/src/editor-schemas/write-editor-schemas.ts",
    name: "writeEditorSchemas",
  },
  { unit: "bundle-fetch", file: "core/compiler/src/bundle/fetch.ts", name: "fetchBundle" },
  {
    unit: "bundle-fetch",
    file: "core/compiler/src/bundle/imports.ts",
    name: "compileWorkspaceWithImports",
  },
];

export interface FileState {
  sha256: string;
  text?: string;
  /** The entries of a `.tgz`, gunzipped: its gzip bytes are not compared, its listing is. */
  ustar?: object[];
}

const TARBALL_SUFFIX = ".tgz";

export interface RecordedCall {
  unit: RecordedUnit;
  function: string;
  args: unknown;
  result?: unknown;
  /** The files the call created or changed under the recording root, relative to it. */
  written: Record<string, FileState>;
  threw?: string;
}

const WRAP_NAME = "__seampactOracleWrap";
const PACKAGES_DIRECTORY = new URL("../../packages/", import.meta.url).href;
const ORIGINAL_SUFFIX = "__oracleOriginal";

interface Session {
  root: string;
  calls: RecordedCall[];
}

let session: Session | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A Map is written as an object in insertion order; any other value as `JSON.stringify` writes it. */
function jsonCopy(value: unknown): unknown {
  const text = JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Map ? Object.fromEntries(member) : member,
  );

  return text === undefined ? undefined : JSON.parse(text);
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function fileStateOf(bytes: Uint8Array): FileState {
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    return { sha256, text: textDecoder.decode(bytes) };
  } catch {
    // Not UTF-8: the hash stands for the file.
    return { sha256 };
  }
}

function fileStateOfPath(path: string, bytes: Uint8Array): FileState {
  const state = fileStateOf(bytes);

  return path.endsWith(TARBALL_SUFFIX)
    ? { ...state, ustar: ustarEntries(gunzipSync(bytes)) }
    : state;
}

/** Every file below `root` as `/`-separated relative paths, `skip` names left out. */
export function snapshotTree(root: string, skip: readonly string[] = []): Map<string, FileState> {
  const files = new Map<string, FileState>();

  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = relative(root, path).split("\\").join("/");

      if (skip.includes(relativePath)) continue;

      if (statSync(path).isDirectory()) walk(path);
      else files.set(relativePath, fileStateOfPath(relativePath, readFileSync(path)));
    }
  };

  walk(root);

  return files;
}

/** The files of `after` that are new or changed against `before`. */
export function writtenBetween(
  before: ReadonlyMap<string, FileState>,
  after: ReadonlyMap<string, FileState>,
): Record<string, FileState> {
  return Object.fromEntries(
    [...after].filter(([path, state]) => before.get(path)?.sha256 !== state.sha256),
  );
}

// The reader a `compileWorkspaceWithImports` call holds is a closure: its root is the call's `fetch.baseDirectory`.
function argsOf(call: RecordedFunction, args: unknown[]): unknown {
  const [first, ...rest] = args;

  if (call.name !== "compileWorkspaceWithImports" || !isRecord(first)) return jsonCopy(args);

  const fetchOptions: unknown = first.fetch;
  const root = isRecord(fetchOptions) ? fetchOptions.baseDirectory : undefined;

  return jsonCopy([{ ...first, reader: { root } }, ...rest]);
}

function settle(call: RecordedCall, recording: Session, before: Map<string, FileState>) {
  call.written = writtenBetween(before, snapshotTree(recording.root));
}

function wrapperFor(call: RecordedFunction, original: (...args: unknown[]) => unknown) {
  return (...args: unknown[]): unknown => {
    const recording = session;

    if (recording === undefined) return original(...args);

    const record: RecordedCall = {
      unit: call.unit,
      function: call.name,
      args: argsOf(call, args),
      written: {},
    };
    const before = snapshotTree(recording.root);

    recording.calls.push(record);

    const finish = (result: unknown): unknown => {
      record.result = jsonCopy(result);
      settle(record, recording, before);

      return result;
    };

    const fail = (error: unknown): never => {
      record.threw = error instanceof Error ? error.message : String(error);
      settle(record, recording, before);

      throw error;
    };

    try {
      const result = original(...args);

      return result instanceof Promise ? result.then(finish, fail) : finish(result);
    } catch (error) {
      return fail(error);
    }
  };
}

function sourceWithWrappers(source: string, names: readonly string[]): string {
  let text = source;
  const appended: string[] = [];

  for (const name of names) {
    const declaration = new RegExp(`^export (async )?function ${name}\\b`, "m");

    if (!declaration.test(text))
      throw new Error(`call recording: no 'export function ${name}' to wrap`);

    text = text.replace(declaration, `$1function ${name}${ORIGINAL_SUFFIX}`);
    appended.push(
      `const ${name} = globalThis.${WRAP_NAME}(${JSON.stringify(name)}, ${name}${ORIGINAL_SUFFIX});`,
      `export { ${name} };`,
    );
  }

  return `${text}\n${appended.join("\n")}\n`;
}

let installed = false;

/** Installs the load hook; call it before the compiler's modules are imported. */
export function installCallRecording(): void {
  if (installed) return;

  installed = true;

  const byFile = new Map<string, RecordedFunction[]>();

  for (const recorded of RECORDED_FUNCTIONS) {
    const url = `${PACKAGES_DIRECTORY}${recorded.file}`;

    byFile.set(url, [...(byFile.get(url) ?? []), recorded]);
  }

  Reflect.set(globalThis, WRAP_NAME, (name: string, original: (...args: unknown[]) => unknown) => {
    const recorded = RECORDED_FUNCTIONS.find((candidate) => candidate.name === name);

    if (recorded === undefined)
      throw new Error(`call recording: ${name} is not a recorded function`);

    return wrapperFor(recorded, original);
  });

  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      const wrapped = byFile.get(url);

      if (wrapped === undefined || result.source === undefined) return result;

      return {
        ...result,
        source: sourceWithWrappers(
          String(result.source),
          wrapped.map(({ name }) => name),
        ),
      };
    },
  });
}

/** Runs `run` and returns the recorded calls, with the files each one wrote under `root`. */
export async function recordCalls<T>(
  root: string,
  run: () => Promise<T>,
): Promise<{ value: T; calls: RecordedCall[] }> {
  if (session !== undefined) throw new Error("call recording: a recording is already running");

  const recording: Session = { root, calls: [] };

  session = recording;

  try {
    const value = await run();

    return { value, calls: recording.calls };
  } finally {
    session = undefined;
  }
}
