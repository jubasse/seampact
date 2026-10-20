import type { ContractIR } from "@seampact/spec/ir";
import type { NativeDocsDocument, NativeDocsJsonObject } from "../native-docs-document.js";
import type { Refusal } from "../refusal.js";

// The one reader of the seampact document a framework's docs follow: per operation id its method, path and
// operation object, and the components of the document. Every docs placement reads the document through it.

export interface DocumentedOperation {
  readonly method: string;
  readonly path: string;
  readonly operation: NativeDocsJsonObject;
}

export interface NativeDocsContract {
  readonly operations: ReadonlyMap<string, DocumentedOperation>;
  readonly components: NativeDocsJsonObject;
}

const PATH_ITEM_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const MISSING_CODE = "nativeDocs.document.missing";
const MALFORMED_CODE = "nativeDocs.document.malformed";
const OPERATION_MISSING_CODE = "nativeDocs.operation.missing";

/**
 * The contract of the passed document, or nothing with the refusals pushed: no document, a document without
 * `paths`, or an operation of the IR the document does not describe.
 */
export function readNativeDocsDocument(
  given: NativeDocsDocument | undefined,
  ir: ContractIR,
  refusals: Refusal[],
): NativeDocsContract | undefined {
  if (given === undefined) {
    refusals.push({
      code: MISSING_CODE,
      message:
        "The `nativeDocs` artefact is on and the request carries no document of the api to follow.",
      fix: "Generate through the seampact CLI, which emits the api's OpenAPI document and passes it, or drop `nativeDocs` from the artefacts.",
    });

    return undefined;
  }

  const paths = given.document.paths;

  if (!isObject(paths)) {
    refusals.push({
      code: MALFORMED_CODE,
      message: "The document passed to `nativeDocs` has no `paths` object.",
      fix: "Pass the document the seampact OpenAPI emitter wrote for this api.",
    });

    return undefined;
  }

  const operations = documentedOperations(paths);
  const missing = ir.operations.filter((operation) => !operations.has(operation.id));

  for (const operation of missing) {
    refusals.push({
      code: OPERATION_MISSING_CODE,
      message: `The document ${documentLabel(given)} does not describe the operation '${operation.id}' this entry generates.`,
      fix: "Choose, with `document` on the target entry, the document that holds every route the entry generates.",
      operation: operation.id,
    });
  }

  if (missing.length > 0) return undefined;

  const components = given.document.components;

  return { operations, components: isObject(components) ? components : {} };
}

function documentLabel(given: NativeDocsDocument): string {
  return given.name === undefined ? "of the api" : `'${given.name}'`;
}

function documentedOperations(paths: NativeDocsJsonObject): Map<string, DocumentedOperation> {
  const operations = new Map<string, DocumentedOperation>();

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;

    for (const method of PATH_ITEM_METHODS) {
      const operation = item[method];

      if (!isObject(operation) || typeof operation.operationId !== "string") continue;

      operations.set(operation.operationId, { method, path, operation });
    }
  }

  return operations;
}

function isObject(value: unknown): value is NativeDocsJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
