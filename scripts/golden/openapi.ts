import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The golden scripts read the OpenAPI emitter through a dynamic import, as they read the compiler (compiler.ts):
// the emitter imports `@seampact/codegen-core`, whose parameter properties the root TypeScript project forbids.
// Each golden IR's documents are written beside it, under `openapi/`.

const OPENAPI_ENTRY = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../packages/core/openapi/src/index.ts",
);

const IR_FILE_SUFFIX = ".ir.json";
const OPENAPI_DIRECTORY = "openapi";

interface EmittedDocument {
  name?: string;
  text: string;
}

type EmitOutcome =
  | { status: "emitted"; documents: EmittedDocument[] }
  | { status: "refused"; refusals: { code: string; message: string; fix: string }[] };

// The module is typed only as far as the guard checks it; each outcome is checked when it is read.
interface OpenApiModule {
  emitDocuments(ir: object): unknown;
}

export interface GoldenOpenApi {
  /** The documents of one IR, keyed by file name (`<api>.<document>.yaml`, or `<api>.yaml` for an api without `documents`). */
  documents(apiName: string, irText: string): { files: Map<string, string>; problems: string[] };
}

function isOpenApiModule(value: unknown): value is OpenApiModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "emitDocuments" in value &&
    typeof value.emitDocuments === "function"
  );
}

function isEmitOutcome(value: unknown): value is EmitOutcome {
  if (typeof value !== "object" || value === null || !("status" in value)) return false;

  if (value.status === "emitted") {
    return (
      "documents" in value &&
      Array.isArray(value.documents) &&
      value.documents.every(isEmittedDocument)
    );
  }

  return (
    value.status === "refused" &&
    "refusals" in value &&
    Array.isArray(value.refusals) &&
    value.refusals.every(isRefusal)
  );
}

function isEmittedDocument(value: unknown): value is EmittedDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string" &&
    (!("name" in value) || value.name === undefined || typeof value.name === "string")
  );
}

function isRefusal(value: unknown): value is { code: string; message: string; fix: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    "fix" in value &&
    typeof value.fix === "string"
  );
}

function goldenOpenApi(openApi: OpenApiModule): GoldenOpenApi {
  return {
    documents(apiName, irText) {
      const files = new Map<string, string>();
      const outcome = openApi.emitDocuments(JSON.parse(irText));

      if (!isEmitOutcome(outcome)) {
        return { files, problems: [`openapi: emitDocuments returned an outcome of another shape`] };
      }

      if (outcome.status === "refused") {
        return {
          files,
          problems: outcome.refusals.map(
            (refusal) => `openapi: ${refusal.code}: ${refusal.message} ${refusal.fix}`,
          ),
        };
      }

      for (const document of outcome.documents) {
        const fileName =
          document.name === undefined ? `${apiName}.yaml` : `${apiName}.${document.name}.yaml`;

        files.set(fileName, document.text);
      }

      return { files, problems: [] };
    },
  };
}

/** The documents of every golden IR in `irFiles`, keyed by repository-relative path. */
export function goldenOpenApiFiles(
  irFiles: ReadonlyMap<string, string>,
  openApi: GoldenOpenApi,
): { files: Map<string, string>; problems: string[] } {
  const files = new Map<string, string>();
  const problems: string[] = [];

  for (const [path, irText] of irFiles) {
    if (!path.endsWith(IR_FILE_SUFFIX)) continue;

    const slash = path.lastIndexOf("/");
    const directory = path.slice(0, slash);
    const apiName = path.slice(slash + 1, -IR_FILE_SUFFIX.length);
    const emitted = openApi.documents(apiName, irText);

    problems.push(...emitted.problems.map((problem) => `${path}: ${problem}`));

    for (const [fileName, text] of emitted.files) {
      files.set(`${directory}/${OPENAPI_DIRECTORY}/${fileName}`, text);
    }
  }

  return { files, problems };
}

/** The emitter's entry module, loaded once. */
export async function loadGoldenOpenApi(): Promise<GoldenOpenApi> {
  const loaded: unknown = await import(pathToFileURL(OPENAPI_ENTRY).href);

  if (!isOpenApiModule(loaded)) {
    throw new Error(`${OPENAPI_ENTRY} does not export the members the golden scripts call`);
  }

  return goldenOpenApi(loaded);
}
