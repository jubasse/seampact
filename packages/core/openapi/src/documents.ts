import { operationLocation, type Refusal, withoutRepeats } from "@seampact/codegen-core";
import {
  type ApiDocument,
  type ContractIR,
  checkIrSupport,
  type DocumentId,
  IR_REVISION,
  IR_VERSION,
  type Operation,
} from "@seampact/spec/ir";
import { requestBody } from "./bodies.js";
import {
  createEmitContext,
  type EmitContext,
  refuseInconsistent,
  writeConsumerExtensions,
  writeExtension,
} from "./emit-context.js";
import { DEFAULT_EMITTER_OPTIONS, type EmitterOptions } from "./emitter-options.js";
import { errorResponses } from "./errors.js";
import { collectExamples } from "./examples.js";
import { compareCodeUnits, type JsonObject, setDefined } from "./json-value.js";
import { writeOperationMarks } from "./operation-marks.js";
import { writePaging } from "./paging.js";
import { operationParameters } from "./parameters.js";
import { successResponses } from "./responses.js";
import { writeOperationRights } from "./rights.js";
import { securitySchemesComponent, writeOperationSecurity } from "./security.js";
import { serializeDocument } from "./serialize.js";

// The documents of one api (ADR 0004 section 12, ADR 0011): one per `api.documents` entry, or one holding every
// surface when the api declares none, each written from the table and serialised as byte-stable YAML.

export const OPENAPI_VERSION = "3.1.0";

const HTTP_OPERATION_KIND = "httpOperation";
const METHOD_ORDER: readonly string[] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export interface EmittedDocument {
  /** The `api.documents` key, or absent for the one document of an api that declares none. */
  name?: DocumentId;
  /** The document as YAML: LF line ends, a final newline, keys in the emitter's order. */
  text: string;
}

export type EmitOutcome =
  | { status: "emitted"; documents: EmittedDocument[] }
  | { status: "refused"; refusals: readonly Refusal[] };

/** The OpenAPI documents of an api, or the refusals that stop them, each naming the IR member and the fix. */
export function emitDocuments(ir: ContractIR, options: EmitterOptions = DEFAULT_EMITTER_OPTIONS): EmitOutcome {
  const unsupported = checkIrSupport(ir, {
    irVersions: [IR_VERSION],
    irRevision: IR_REVISION,
    kinds: [HTTP_OPERATION_KIND],
    features: [],
  });

  if (unsupported.length > 0) {
    return {
      status: "refused",
      refusals: unsupported.map((mismatch) => ({
        code: mismatch.code,
        message: mismatch.message,
        fix: "Use the @seampact/openapi release built for the IR this seampact version writes.",
        member: mismatch.member,
        ...(mismatch.operation === undefined ? {} : { operation: mismatch.operation }),
      })),
    };
  }

  const refusals: Refusal[] = [];
  const documents: EmittedDocument[] = [];
  const declared = Object.entries(ir.api.documents);
  const plans: { name?: DocumentId; selection: ApiDocument }[] =
    declared.length === 0
      ? [{ selection: { surfaces: Object.keys(ir.api.surfaces), internal: "include" } }]
      : declared.map(([name, selection]) => ({ name, selection }));

  for (const plan of plans) {
    const context = createEmitContext(ir, options);
    const document = buildDocument(context, plan.selection);

    refusals.push(...context.refusals);

    const emitted: EmittedDocument = { text: serializeDocument(document) };

    if (plan.name !== undefined) emitted.name = plan.name;

    documents.push(emitted);
  }

  if (refusals.length > 0) return { status: "refused", refusals: withoutRepeats(refusals) };

  return { status: "emitted", documents };
}

function selectedOperations(ir: ContractIR, selection: ApiDocument): { operation: Operation; index: number }[] {
  return ir.operations
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => selection.surfaces.includes(operation.surface))
    .filter(({ operation }) => !(operation.internal && selection.internal === "exclude"));
}

function buildDocument(context: EmitContext, selection: ApiDocument): JsonObject {
  const { ir } = context;
  const selected = selectedOperations(ir, selection);
  const documentFormat = mostUsedFormat(selected.map(({ operation }) => operation.format));
  const paths = pathsObject(context, selected, documentFormat);
  const schemas = drainSchemaComponents(context);
  const securitySchemes = securitySchemesComponent(context);
  const document: JsonObject = { openapi: OPENAPI_VERSION, info: infoObject(ir) };

  if (context.options.servers.length > 0) {
    document.servers = context.options.servers.map((server) => {
      const serverObject: JsonObject = { url: server.url };

      setDefined(serverObject, "description", server.description);

      return serverObject;
    });
  }

  const tags = [...new Set(selected.flatMap(({ operation }) => operation.tags))].sort(compareCodeUnits);

  if (tags.length > 0) document.tags = tags.map((name) => ({ name }));

  const apiValue: JsonObject = { kind: ir.api.kind };

  setDefined(apiValue, "role", ir.api.role);

  if (ir.api.caller !== undefined) {
    apiValue.caller = { identity: ir.api.caller.identity, right: ir.api.caller.right };
  }

  writeExtension(context, document, "api", apiValue);

  if (documentFormat !== undefined) writeExtension(context, document, "format", documentFormat);

  writeConsumerExtensions(document, ir.api.extensions);
  document.paths = paths;

  const components: JsonObject = {};

  if (Object.keys(schemas).length > 0) components.schemas = schemas;

  if (Object.keys(securitySchemes).length > 0) components.securitySchemes = securitySchemes;

  if (Object.keys(components).length > 0) document.components = components;

  return document;
}

function infoObject(ir: ContractIR): JsonObject {
  const version = ir.api.version;
  const info: JsonObject = {
    title: ir.api.id,
    version: version.kind === "path" && "number" in version ? String(version.number) : versionLabel(version),
  };

  setDefined(info, "summary", ir.api.docs.summary);
  setDefined(info, "description", ir.api.docs.description);

  return info;
}

function versionLabel(version: ContractIR["api"]["version"]): string {
  return "label" in version && typeof version.label === "string" ? version.label : String(version.kind);
}

// The format most operations use is the document's; ties go to the first id in code-unit order.
function mostUsedFormat(formats: readonly string[]): string | undefined {
  const counts = new Map<string, number>();

  for (const format of formats) counts.set(format, (counts.get(format) ?? 0) + 1);

  return [...counts.entries()]
    .sort(([leftFormat, leftCount], [rightFormat, rightCount]) =>
      leftCount === rightCount ? compareCodeUnits(leftFormat, rightFormat) : rightCount - leftCount,
    )
    .at(0)?.[0];
}

function pathsObject(
  context: EmitContext,
  selected: readonly { operation: Operation; index: number }[],
  documentFormat: string | undefined,
): JsonObject {
  const byPath = new Map<string, { operation: Operation; index: number }[]>();

  for (const entry of selected) {
    const entries = byPath.get(entry.operation.path) ?? [];

    entries.push(entry);
    byPath.set(entry.operation.path, entries);
  }

  const paths: JsonObject = {};

  for (const path of [...byPath.keys()].sort(compareCodeUnits)) {
    const pathItem: JsonObject = {};
    const entries = [...(byPath.get(path) ?? [])].sort(
      (left, right) => methodRank(left.operation.method) - methodRank(right.operation.method),
    );

    for (const { operation, index } of entries) {
      pathItem[operation.method] = operationObject(context, operation, index, documentFormat);
    }

    paths[path] = pathItem;
  }

  return paths;
}

function methodRank(method: string): number {
  const rank = METHOD_ORDER.indexOf(method);

  return rank === -1 ? METHOD_ORDER.length : rank;
}

function operationObject(
  context: EmitContext,
  operation: Operation,
  index: number,
  documentFormat: string | undefined,
): JsonObject {
  const location = operationLocation(index, operation.id);
  const operationObject: JsonObject = {};

  if (operation.tags.length > 0) operationObject.tags = [...operation.tags];

  setDefined(operationObject, "summary", operation.docs.summary);
  setDefined(operationObject, "description", operation.docs.description);
  operationObject.operationId = operation.id;

  if (operation.deprecated !== undefined) operationObject.deprecated = true;

  const parameters = operationParameters(context, operation, location);

  if (parameters.length > 0) operationObject.parameters = parameters;

  const examples = collectExamples(context, operation, location);
  const body = requestBody(context, operation, examples.request, location);

  if (body !== undefined) operationObject.requestBody = body;

  operationObject.responses = responsesObject(context, operation, examples, location);
  writeOperationSecurity(context, operation, operationObject, location);
  writeOperationRights(context, operation, operationObject, location);
  writePaging(context, operation, operationObject);
  writeOperationMarks(context, operation, documentFormat, operationObject, location);
  writeConsumerExtensions(operationObject, operation.extensions);

  return operationObject;
}

function responsesObject(
  context: EmitContext,
  operation: Operation,
  examples: ReturnType<typeof collectExamples>,
  location: ReturnType<typeof operationLocation>,
): JsonObject {
  const success = successResponses(context, operation, examples, location);
  const errors = errorResponses(context, operation, location);
  const statuses = [...new Set([...success.keys(), ...errors.keys()])].sort((left, right) => left - right);
  const responses: JsonObject = {};

  for (const status of statuses) {
    const response = success.get(status) ?? errors.get(status);

    if (success.has(status) && errors.has(status)) {
      refuseInconsistent(
        context,
        "response.status",
        `The status ${status} is both a success and an error response`,
        location,
      );
    }

    if (response !== undefined) responses[String(status)] = response;
  }

  return responses;
}

// Writing a component can reference others, so the queue runs until no component is pending.
function drainSchemaComponents(context: EmitContext): JsonObject {
  const written = new Map<string, JsonObject>();

  for (let request = context.pendingComponents.shift(); request !== undefined; request = context.pendingComponents.shift()) {
    written.set(request.key, request.build(context));
  }

  const schemas: JsonObject = {};

  for (const key of [...written.keys()].sort(compareCodeUnits)) {
    const schema = written.get(key);

    if (schema !== undefined) schemas[key] = schema;
  }

  return schemas;
}
