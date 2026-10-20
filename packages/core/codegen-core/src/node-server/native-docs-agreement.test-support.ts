import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { NativeDocsDocument, NativeDocsJsonObject } from "../native-docs-document.js";

// Test support of the `nativeDocs` artefact: the seampact document of a reference api, as the CLI passes it, and the
// agreement rule between it and the document a framework writes: for every operation of the seampact document, the
// same operation id at the same method and path, the same response codes, the same parameters with equal schemas, and
// equal request body and response schemas per media type once `$ref` is resolved in each document. A method on a path
// the seampact document does not hold is a difference: the framework's own entries for the generated routes.

const GOLDEN_OPENAPI = new URL(
  "../../../../../fixtures/golden/reference/openapi/",
  import.meta.url,
);

const REFERENCE_DOCUMENTS: Readonly<Record<string, { file: string; name?: string }>> = {
  tasks: { file: "tasks.full.yaml", name: "full" },
  tasksService: { file: "tasksService.yaml" },
};

const OPERATION_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const COMPONENT_REFERENCE = /^#\/components\/(.+)$/;

type Json = null | boolean | number | string | Json[] | { [member: string]: Json };

/** The committed golden document of a reference api that holds every route, parsed as the CLI passes it. */
export function referenceNativeDocsDocument(api: string): NativeDocsDocument {
  const reference = REFERENCE_DOCUMENTS[api];

  if (reference === undefined) throw new Error(`no reference document for the api '${api}'`);

  const text = readFileSync(new URL(reference.file, GOLDEN_OPENAPI), "utf8");
  const document: NativeDocsJsonObject = parse(text);

  return reference.name === undefined ? { document } : { name: reference.name, document };
}

/** The differences between the framework's document and the seampact one; empty when they agree. */
export function nativeDocsDisagreements(
  seampact: NativeDocsJsonObject,
  framework: unknown,
): string[] {
  const seampactOperations = operationsOf(seampact);
  const frameworkOperations = operationsOf(framework);
  const differences: string[] = [];

  for (const [id, expected] of seampactOperations) {
    const found = frameworkOperations.get(id);

    if (found === undefined) {
      differences.push(`${id}: missing from the framework document`);

      continue;
    }

    if (found.method !== expected.method || found.path !== expected.path) {
      differences.push(
        `${id}: ${found.method.toUpperCase()} ${found.path} instead of ${expected.method.toUpperCase()} ${expected.path}`,
      );

      continue;
    }

    differences.push(
      ...operationDifferences(id, expected.operation, found.operation, seampact, framework),
    );
  }

  differences.push(...extraOperations(seampact, framework));

  return differences;
}

function extraOperations(seampact: unknown, framework: unknown): string[] {
  const held = new Set(methodPaths(seampact));

  return methodPaths(framework)
    .filter((methodPath) => !held.has(methodPath))
    .map((methodPath) => `${methodPath}: not in the seampact document`);
}

// Every `METHOD path` that carries an operation object.
function methodPaths(document: unknown): string[] {
  return Object.entries(recordAt(document, "paths")).flatMap(([path, item]) =>
    OPERATION_METHODS.filter((method) => memberAt(item, method) !== undefined).map(
      (method) => `${method.toUpperCase()} ${path}`,
    ),
  );
}

interface FoundOperation {
  method: string;
  path: string;
  operation: Record<string, unknown>;
}

function operationsOf(document: unknown): Map<string, FoundOperation> {
  const operations = new Map<string, FoundOperation>();
  const paths = recordAt(document, "paths");

  for (const [path, item] of Object.entries(paths)) {
    for (const method of OPERATION_METHODS) {
      const operation = recordAt(item, method);

      if (typeof operation.operationId === "string") {
        operations.set(operation.operationId, { method, path, operation });
      }
    }
  }

  return operations;
}

function operationDifferences(
  id: string,
  expected: Record<string, unknown>,
  found: Record<string, unknown>,
  seampact: unknown,
  framework: unknown,
): string[] {
  const expectedResponses = recordAt(expected, "responses");
  const foundResponses = recordAt(found, "responses");
  const expectedCodes = Object.keys(expectedResponses).sort();
  const foundCodes = Object.keys(foundResponses).sort();
  const differences: string[] = [];

  if (expectedCodes.join() !== foundCodes.join()) {
    differences.push(
      `${id}: response codes ${foundCodes.join()} instead of ${expectedCodes.join()}`,
    );
  }

  const expectedParameters = parameterKeys(expected, seampact);
  const foundParameters = parameterKeys(found, framework);

  if (expectedParameters.join() !== foundParameters.join()) {
    differences.push(
      `${id}: parameters ${foundParameters.join()} instead of ${expectedParameters.join()}`,
    );
  }

  const slots: [string, unknown, unknown][] = [
    ["request body", expected.requestBody, found.requestBody],
    ...expectedCodes.map((code): [string, unknown, unknown] => [
      `response ${code}`,
      expectedResponses[code],
      foundResponses[code],
    ]),
  ];

  for (const [slot, expectedSlot, foundSlot] of slots) {
    differences.push(
      ...mediaDifferences(
        id,
        slot,
        resolved(expectedSlot, seampact),
        resolved(foundSlot, framework),
        seampact,
        framework,
      ),
    );
  }

  return differences;
}

// Each parameter as `in:name:required:schema` (the schema with `$ref` resolved), sorted.
function parameterKeys(operation: Record<string, unknown>, document: unknown): string[] {
  const parameters: unknown = operation.parameters;

  if (!Array.isArray(parameters)) return [];

  return parameters
    .map(
      (parameter) =>
        `${String(memberAt(parameter, "in"))}:${String(memberAt(parameter, "name"))}:${String(memberAt(parameter, "required"))}:${JSON.stringify(resolvedDeep(memberAt(parameter, "schema"), document))}`,
    )
    .sort();
}

function mediaDifferences(
  id: string,
  slot: string,
  expected: unknown,
  found: unknown,
  seampact: unknown,
  framework: unknown,
): string[] {
  const expectedContent = recordAt(expected, "content");
  const foundContent = recordAt(found, "content");
  const differences: string[] = [];

  for (const [media, expectedMedia] of Object.entries(expectedContent)) {
    const expectedSchema = resolvedDeep(recordAt(expectedMedia, "schema"), seampact);
    const foundSchema = resolvedDeep(recordAt(foundContent[media], "schema"), framework);

    if (JSON.stringify(expectedSchema) !== JSON.stringify(foundSchema)) {
      differences.push(`${id}: ${slot} schema for ${media} differs`);
    }
  }

  return differences;
}

function memberAt(value: unknown, member: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, member) : undefined;
}

function recordAt(value: unknown, member: string): Record<string, unknown> {
  const inner = memberAt(value, member);

  return typeof inner === "object" && inner !== null && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner))
    : {};
}

// A response or request body written as a `$ref` to `#/components/...` is read through it.
function resolved(value: unknown, document: unknown): unknown {
  const target = referenceTarget(value);

  return target === undefined ? value : resolved(pointerValue(document, target), document);
}

// Every `$ref` of a schema replaced by what it points at, a cycle left as its reference.
function resolvedDeep(value: unknown, document: unknown, seen: readonly string[] = []): Json {
  if (Array.isArray(value)) return value.map((item) => resolvedDeep(item, document, seen));

  if (typeof value !== "object" || value === null) return primitiveJson(value);

  const target = referenceTarget(value);

  if (target !== undefined) {
    if (seen.includes(target)) return { $ref: target };

    return resolvedDeep(pointerValue(document, target), document, [...seen, target]);
  }

  return Object.fromEntries(
    Object.entries(value).map(([member, inner]) => [member, resolvedDeep(inner, document, seen)]),
  );
}

function primitiveJson(value: unknown): Json {
  if (value === undefined) return null;

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  throw new Error(`not a JSON value: ${String(value)}`);
}

function referenceTarget(value: unknown): string | undefined {
  const reference: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "$ref") : undefined;

  return typeof reference === "string" && COMPONENT_REFERENCE.test(reference)
    ? reference
    : undefined;
}

function pointerValue(document: unknown, reference: string): unknown {
  const [, path = ""] = COMPONENT_REFERENCE.exec(reference) ?? [];

  return path
    .split("/")
    .reduce<unknown>(
      (current, segment) => memberAt(current, segment),
      memberAt(document, "components"),
    );
}

const WRITE_GOLDEN_VARIABLE = "SEAMPACT_WRITE_GOLDEN";

/**
 * The committed native document at `golden` as text, and what `document` renders to as YAML. Both are the same when
 * the golden is current; `SEAMPACT_WRITE_GOLDEN=1` rewrites the golden first.
 */
export function nativeGoldenComparison(
  golden: URL,
  document: unknown,
): { committed: string; current: string } {
  const current = stringify(document, { lineWidth: 0 });

  if (process.env[WRITE_GOLDEN_VARIABLE] === "1") {
    mkdirSync(dirname(fileURLToPath(golden)), { recursive: true });
    writeFileSync(golden, current);
  }

  return { committed: existsSync(golden) ? readFileSync(golden, "utf8") : "", current };
}
