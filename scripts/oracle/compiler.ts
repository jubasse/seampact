import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

// The oracle reads the TS compiler through a dynamic import, as `scripts/golden/compiler.ts` does: the root
// TypeScript project forbids the parameter properties the compiler sources use, so a static import would make
// `pnpm typecheck` report the compiler's files. The adapter names the members it calls and checks them at run time.

const SOURCES = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../packages/core/compiler/src",
);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [member: string]: JsonValue };

/** One diagnostic as the compiler returns it; the oracle writes it whole, so no member is named here. */
export type OracleDiagnostic = object;

/** The delta one half wrote to the draft of an api, in the `draft-fixture.ts` convention. */
export interface HalfDelta {
  api: string;
  half: string;
  delta: object;
  /** What the half reported, sorted as `diagnostics.json` is; empty when it reported nothing. */
  diagnostics: OracleDiagnostic[];
}

/** One question the later halves asked the schema service of an api, with its answer (absent: it answered undefined). */
export interface SchemaCall {
  method: string;
  args: unknown[];
  answer?: unknown;
}

export interface SchemaCalls {
  api: string;
  /** Deduplicated by method and arguments, in the order of the first call. */
  calls: SchemaCall[];
}

export interface OracleApiResult {
  api: string;
  diagnostics: OracleDiagnostic[];
  irText?: string;
  sourceMapText?: string;
}

export interface OracleCompilation {
  diagnostics: OracleDiagnostic[];
  apis: OracleApiResult[];
  /** Per api, the halves that ran, in run order. */
  halves: HalfDelta[];
  /** Per api with at least one schema service call. */
  schemaCalls: SchemaCalls[];
}

export interface OracleCompiler {
  halveNames: readonly string[];
  compile(root: string, entry: string): OracleCompilation;
}

interface Part {
  run(draft: object, context: object): unknown;
}

interface PipelineModule {
  loadFsReader(root: string): object;
  pipelineDefaultParts(): { passes: Record<string, Part> };
  pipelineHalves: readonly string[];
  compileWorkspace(options: { reader: object; entry: string; parts: object }): {
    diagnostics: readonly object[];
    apis: { api: string; diagnostics: readonly object[]; ir?: object; sourceMap?: object }[];
  };
  finalizeSerializeJson(value: object): string;
  pipelineCopy<T>(value: T): T;
  diagnosticSort(diagnostics: readonly object[], locations: object): object[];
}

interface DeltaModule {
  draftFixtureDelta(before: object, after: object): object;
}

const hasFunctions = (value: unknown, names: readonly string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  names.every((name) => name in value && typeof Reflect.get(value, name) === "function");

function isPipelineModule(value: unknown): value is PipelineModule {
  return (
    hasFunctions(value, [
      "loadFsReader",
      "pipelineDefaultParts",
      "compileWorkspace",
      "finalizeSerializeJson",
      "pipelineCopy",
      "diagnosticSort",
    ]) && Array.isArray(Reflect.get(value as object, "pipelineHalves"))
  );
}

const isDeltaModule = (value: unknown): value is DeltaModule =>
  hasFunctions(value, ["draftFixtureDelta"]);

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

// The name of the api a half ran for: `context.raw.name`.
function apiNameOf(context: object): string {
  const raw: unknown = Reflect.get(context, "raw");
  const name: unknown = isObject(raw) ? Reflect.get(raw, "name") : undefined;

  if (typeof name !== "string") throw new Error("a half ran with no api name in its context");

  return name;
}

const SCHEMA_SERVICE_METHODS = [
  "typeUse",
  "checkExample",
  "queryWire",
  "checkTextExample",
] as const;

// The context of a half whose `report` also keeps what the half reported.
function contextKeepingReports(context: object, reported: object[]): object {
  const report: unknown = Reflect.get(context, "report");

  if (typeof report !== "function") throw new Error("a half ran with no report function");

  return Object.freeze({
    ...context,
    report: (diagnostic: object) => {
      reported.push(diagnostic);
      Reflect.apply(report, context, [diagnostic]);
    },
  });
}

function locationsOf(context: object): object {
  const raw: unknown = Reflect.get(context, "raw");
  const locations: unknown = isObject(raw) ? Reflect.get(raw, "locations") : undefined;

  if (!isObject(locations)) throw new Error("a half ran with no source locations in its context");

  return locations;
}

// The schema service, answering as `service` does and logging each distinct call. Arguments and answers are copied
// with `pipelineCopy`: with the guard on they are read-only views, which `structuredClone` refuses.
function loggingSchemaService(
  pipeline: PipelineModule,
  service: object,
  calls: Map<string, SchemaCall>,
): object {
  const logged = (method: string): unknown => {
    const original: unknown = Reflect.get(service, method);

    if (typeof original !== "function") throw new Error(`the schema service has no ${method}`);

    return (...args: unknown[]): unknown => {
      const answer: unknown = Reflect.apply(original, service, args);
      const call: SchemaCall = {
        method,
        args: pipeline.pipelineCopy(args),
        ...(answer === undefined ? {} : { answer: pipeline.pipelineCopy(answer) }),
      };
      const key = JSON.stringify([call.method, call.args]);
      const earlier = calls.get(key);

      if (earlier === undefined) calls.set(key, call);
      else if (JSON.stringify(earlier.answer) !== JSON.stringify(call.answer))
        throw new Error(`the schema service answered ${key} twice with different answers`);

      return answer;
    };
  };

  return Object.fromEntries(SCHEMA_SERVICE_METHODS.map((method) => [method, logged(method)]));
}

interface Recording {
  halves: HalfDelta[];
  /** Per api name, the schema service calls by (method, arguments). */
  schemaCalls: Map<string, Map<string, SchemaCall>>;
}

function recordingPasses(
  pipeline: PipelineModule,
  deltas: DeltaModule,
  recording: Recording,
): Record<string, Part> {
  const defaults = pipeline.pipelineDefaultParts().passes;

  return Object.fromEntries(
    pipeline.pipelineHalves.map((half) => {
      const part = defaults[half];

      if (part === undefined) throw new Error(`the default parts have no half ${half}`);

      const run = (draft: object, context: object): unknown => {
        const api = apiNameOf(context);
        const reported: object[] = [];
        const before = structuredClone(draft);
        const result = part.run(draft, contextKeepingReports(context, reported));

        recording.halves.push({
          api,
          half,
          delta: deltas.draftFixtureDelta(before, draft),
          diagnostics: pipeline.diagnosticSort(reported, locationsOf(context)),
        });

        if (half !== "tree.schemas") return result;

        if (!isObject(result)) throw new Error(`tree.schemas of ${api} returned no schema service`);

        const calls = new Map<string, SchemaCall>();

        recording.schemaCalls.set(api, calls);

        return loggingSchemaService(pipeline, result, calls);
      };

      return [half, { ...part, run }];
    }),
  );
}

// `compileWorkspace` does not resolve workspace imports as the CLI does, so such a fixture is named in `excluded.json`.
// A file that does not parse is the compiler's to report as a diagnostic, so it is left to it.
function refuseWorkspaceImports(root: string, entry: string): void {
  const document = parseDocument(readFileSync(join(root, entry), "utf8"), { uniqueKeys: false });

  if (document.errors.length === 0 && document.hasIn(["workspace", "imports"]))
    throw new Error(
      `${join(root, entry)} has workspace.imports, which the oracle does not resolve: add the fixture to scripts/oracle/excluded.json`,
    );
}

function oracleCompiler(pipeline: PipelineModule, deltas: DeltaModule): OracleCompiler {
  return {
    halveNames: pipeline.pipelineHalves,
    compile(root, entry) {
      refuseWorkspaceImports(root, entry);

      const recording: Recording = { halves: [], schemaCalls: new Map() };
      const result = pipeline.compileWorkspace({
        reader: pipeline.loadFsReader(root),
        entry,
        parts: { passes: recordingPasses(pipeline, deltas, recording) },
      });

      return {
        diagnostics: [...result.diagnostics],
        halves: recording.halves,
        schemaCalls: [...recording.schemaCalls]
          .map(([api, calls]) => ({ api, calls: [...calls.values()] }))
          .filter(({ calls }) => calls.length > 0),
        apis: result.apis.map((api) => ({
          api: api.api,
          diagnostics: [...api.diagnostics],
          ...(api.ir === undefined ? {} : { irText: pipeline.finalizeSerializeJson(api.ir) }),
          ...(api.sourceMap === undefined
            ? {}
            : { sourceMapText: pipeline.finalizeSerializeJson(api.sourceMap) }),
        })),
      };
    },
  };
}

/** The compiler, loaded once. */
export async function loadOracleCompiler(): Promise<OracleCompiler> {
  const pipeline: unknown = await import(pathToFileURL(`${SOURCES}/index.ts`).href);
  const deltas: unknown = await import(pathToFileURL(`${SOURCES}/pipeline/draft-fixture.ts`).href);

  if (!isPipelineModule(pipeline) || !isDeltaModule(deltas))
    throw new Error(`${SOURCES} does not export the members the oracle calls`);

  return oracleCompiler(pipeline, deltas);
}
