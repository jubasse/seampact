import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installCallRecording } from "./call-recording.ts";

// The tools the oracle runs, loaded by dynamic import as `compiler.ts` loads the compiler: the root TypeScript
// project forbids the parameter properties their sources use. Each adapter names the members it calls and checks
// them at run time.

const PACKAGES = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../packages/core");

export interface RefusalLike {
  code: string;
  message: string;
  fix: string;
  operation?: string;
  member?: string;
  docs?: string;
}

export type EmitOutcomeLike =
  | { status: "emitted"; documents: { name?: string; text: string }[] }
  | { status: "refused"; refusals: readonly RefusalLike[] };

export type MergeOutcomeLike =
  | { status: "merged"; text: string }
  | { status: "refused"; refusals: readonly RefusalLike[] };

export type ParsedOptionsLike =
  | { status: "parsed"; options: object }
  | { status: "refused"; refusals: readonly RefusalLike[] };

export interface BundleContentsLike {
  manifest: { files: object[]; integrity: string; compiler: object };
  files: ReadonlyMap<string, Uint8Array>;
}

export type BuildBundleOutcomeLike =
  | { ok: true; contents: BundleContentsLike }
  | { ok: false; failures: readonly object[] };

export interface LoadedReader {
  readText(file: string, maxBytes: number): unknown;
}

export interface OracleCliIo {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  today(): string;
}

export interface OracleTools {
  emitDocuments(ir: object, options?: object): EmitOutcomeLike;
  parseEmitterOptions(raw: unknown): ParsedOptionsLike;
  mergeDocuments(inputs: readonly object[], options: object): MergeOutcomeLike;
  runLint(input: {
    ir: object;
    declared: readonly object[];
    locations: object;
    plugins: [];
  }): Promise<object[]>;
  diffContracts(before: object, after: object, options: object): object;
  diffContractSets(
    before: ReadonlyMap<string, object>,
    after: ReadonlyMap<string, object>,
    options: object,
  ): Map<string, object>;
  formatDiffReport(result: object): string;
  diffTable: { codes: unknown; table: unknown };
  buildBundle(options: {
    reader: LoadedReader;
    entry: string;
    contract?: object;
  }): BuildBundleOutcomeLike;
  bundleTarball(contents: BundleContentsLike): Uint8Array;
  bundleManifestBytes(manifest: object): Uint8Array;
  loadFsReader(root: string): LoadedReader;
  runCli(argv: readonly string[], io: OracleCliIo): Promise<number>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function member(module: unknown, name: string, from: string): unknown {
  if (!isObject(module) || !(name in module)) throw new Error(`${from} does not export ${name}`);

  return module[name];
}

function functionOf<Function extends (...args: never[]) => unknown>(
  module: unknown,
  name: string,
  from: string,
): Function {
  const value = member(module, name, from);

  if (typeof value !== "function") throw new Error(`${from}: ${name} is not a function`);

  return value as Function;
}

const importSource = (relative: string): Promise<unknown> =>
  import(pathToFileURL(resolve(PACKAGES, relative)).href);

let loaded: Promise<OracleTools> | undefined;

async function loadTools(): Promise<OracleTools> {
  // Before any module of the compiler loads: the hook wraps the functions the CLI calls.
  installCallRecording();

  const compiler = await importSource("compiler/src/index.ts");
  const openapi = await importSource("openapi/src/index.ts");
  const lint = await importSource("lint/src/index.ts");
  const diff = await importSource("diff/src/index.ts");
  const cli = await importSource("cli/src/index.ts");
  const from = (name: string) => `${PACKAGES}/${name}`;

  return {
    emitDocuments: functionOf(openapi, "emitDocuments", from("openapi")),
    parseEmitterOptions: functionOf(openapi, "parseEmitterOptions", from("openapi")),
    mergeDocuments: functionOf(openapi, "mergeDocuments", from("openapi")),
    runLint: functionOf(lint, "runLint", from("lint")),
    diffContracts: functionOf(diff, "diffContracts", from("diff")),
    diffContractSets: functionOf(diff, "diffContractSets", from("diff")),
    formatDiffReport: functionOf(diff, "formatDiffReport", from("diff")),
    diffTable: {
      codes: member(diff, "DIFF_CODES", from("diff")),
      table: member(diff, "DIFF_TABLE", from("diff")),
    },
    buildBundle: functionOf(compiler, "buildBundle", from("compiler")),
    bundleTarball: functionOf(compiler, "bundleTarball", from("compiler")),
    bundleManifestBytes: functionOf(compiler, "bundleManifestBytes", from("compiler")),
    loadFsReader: functionOf(compiler, "loadFsReader", from("compiler")),
    runCli: functionOf(cli, "runCli", from("cli")),
  };
}

/** The tools, loaded once. */
export function loadOracleTools(): Promise<OracleTools> {
  loaded ??= loadTools();

  return loaded;
}
