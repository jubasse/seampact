import {
  compareCodeUnits,
  operationLocation,
  type Refusal,
  withoutRepeats,
} from "@seampact/codegen-core";
import {
  type ApiDocument,
  type ContractIR,
  checkIrSupport,
  type DocumentId,
  IR_REVISION,
  IR_VERSION,
  isKnownVariant,
  type Operation,
} from "@seampact/spec/ir";
import { requestBody } from "./bodies.js";
import {
  createEmitContext,
  type EmitContext,
  refuseInconsistent,
  refuseUnknown,
  writeConsumerExtensions,
  writeExtension,
} from "./emit-context.js";
import { DEFAULT_EMITTER_OPTIONS, type EmitterOptions } from "./emitter-options.js";
import { errorResponses } from "./errors.js";
import { collectExamples } from "./examples.js";
import { type JsonObject, setDefined } from "./json-value.js";
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
const METHOD_ORDER: readonly string[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

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
export function emitDocuments(
  ir: ContractIR,
  options: EmitterOptions = DEFAULT_EMITTER_OPTIONS,
): EmitOutcome {
  const unsupported = unsupportedIrRefusals(ir);

  if (unsupported.length > 0) return { status: "refused", refusals: unsupported };

  const refusals: Refusal[] = [];
  const documents: EmittedDocument[] = [];

  for (const plan of documentPlans(ir)) {
    const built = buildPlannedDocument(ir, options, plan.selection);

    refusals.push(...built.refusals);

    const emitted: EmittedDocument = { text: serializeDocument(built.document) };

    if (plan.name !== undefined) emitted.name = plan.name;

    documents.push(emitted);
  }

  if (refusals.length > 0) return { status: "refused", refusals: withoutRepeats(refusals) };

  return { status: "emitted", documents };
}

interface DocumentPlan {
  /** The `api.documents` key, or absent for the one document holding every surface. */
  name?: DocumentId;
  selection: ApiDocument;
}

/** One plan per `api.documents` entry, or one holding every surface with internal routes kept. */
function documentPlans(ir: ContractIR): DocumentPlan[] {
  const declared = Object.entries(ir.api.documents);

  return declared.length === 0
    ? [{ selection: everySurfaceSelection(ir) }]
    : declared.map(([name, selection]) => ({ name, selection }));
}

/** The selection of an api's one document when it declares none: every surface, internal routes kept. */
export function everySurfaceSelection(ir: ContractIR): ApiDocument {
  return { surfaces: Object.keys(ir.api.surfaces), internal: "include" };
}

/** The refusals of an IR this emitter cannot read: another IR version or revision, or an unknown kind. */
export function unsupportedIrRefusals(ir: ContractIR): Refusal[] {
  const unsupported = checkIrSupport(ir, {
    irVersions: [IR_VERSION],
    irRevision: IR_REVISION,
    kinds: [HTTP_OPERATION_KIND],
    features: [],
  });

  return unsupported.map((mismatch) => ({
    code: mismatch.code,
    message: mismatch.message,
    fix: "Use the @seampact/openapi release built for the IR this seampact version writes.",
    member: mismatch.member,
    ...(mismatch.operation === undefined ? {} : { operation: mismatch.operation }),
  }));
}

/** One document of an api as a JSON object, with the refusals its mapping raised. */
export function buildPlannedDocument(
  ir: ContractIR,
  options: EmitterOptions,
  selection: ApiDocument,
): { document: JsonObject; refusals: readonly Refusal[] } {
  const context = createEmitContext(ir, options);
  const document = buildDocument(context, selection);

  return { document, refusals: context.refusals };
}

function selectedOperations(
  ir: ContractIR,
  selection: ApiDocument,
): { operation: Operation; index: number }[] {
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
  const document: JsonObject = { openapi: OPENAPI_VERSION, info: infoObject(context) };

  if (context.options.servers.length > 0) document.servers = serversArray(context.options);

  const tags = [...new Set(selected.flatMap(({ operation }) => operation.tags))].sort(
    compareCodeUnits,
  );

  if (tags.length > 0) document.tags = tags.map((name) => ({ name }));

  writeExtension(context, document, "api", apiExtensionValue(ir));

  if (documentFormat !== undefined) writeExtension(context, document, "format", documentFormat);

  writeConsumerExtensions(document, ir.api.extensions);
  document.paths = paths;

  const components: JsonObject = {};

  if (Object.keys(schemas).length > 0) components.schemas = schemas;

  if (Object.keys(securitySchemes).length > 0) components.securitySchemes = securitySchemes;

  if (Object.keys(components).length > 0) document.components = components;

  return document;
}

/** What `x-seampact-api` says of an api: its kind, role and caller. */
export function apiExtensionValue(ir: ContractIR): JsonObject {
  const apiValue: JsonObject = { kind: ir.api.kind };

  setDefined(apiValue, "role", ir.api.role);

  if (ir.api.caller !== undefined) {
    apiValue.caller = { identity: ir.api.caller.identity, right: ir.api.caller.right };
  }

  return apiValue;
}

function infoObject(context: EmitContext): JsonObject {
  const { api } = context.ir;
  const info: JsonObject = { title: api.id, version: apiVersionText(context) };

  setDefined(info, "summary", api.docs.summary);
  setDefined(info, "description", api.docs.description);

  return info;
}

function apiVersionText(context: EmitContext): string {
  const version = context.ir.api.version;

  if (!isKnownVariant("ApiVersion", version)) {
    refuseUnknown(context, { member: "/api/version/kind" }, version.kind);

    return "";
  }

  return version.kind === "path" ? String(version.number) : version.label;
}

// The format most operations use is the document's; ties go to the first id in code-unit order.
export function mostUsedFormat(formats: readonly string[]): string | undefined {
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
  return pathsByRoute(
    selected,
    ({ operation }) => operation,
    ({ operation, index }) => operationObject(context, operation, index, documentFormat),
  );
}

/** The `servers` array of the `servers` option. */
export function serversArray(options: EmitterOptions): JsonObject[] {
  return options.servers.map((server) => {
    const serverObject: JsonObject = { url: server.url };

    setDefined(serverObject, "description", server.description);

    return serverObject;
  });
}

/** The `paths` object: a path item per path in code-unit order, each with its operations in method order. */
export function pathsByRoute<Entry>(
  entries: readonly Entry[],
  routeOf: (entry: Entry) => { path: string; method: string },
  operationObjectOf: (entry: Entry) => JsonObject,
): JsonObject {
  const byPath = new Map<string, Entry[]>();

  for (const entry of entries) {
    const { path } = routeOf(entry);
    const pathEntries = byPath.get(path) ?? [];

    pathEntries.push(entry);
    byPath.set(path, pathEntries);
  }

  const paths: JsonObject = {};

  for (const path of [...byPath.keys()].sort(compareCodeUnits)) {
    const pathItem: JsonObject = {};
    const pathEntries = [...(byPath.get(path) ?? [])].sort(
      (left, right) => methodRank(routeOf(left).method) - methodRank(routeOf(right).method),
    );

    for (const entry of pathEntries) pathItem[routeOf(entry).method] = operationObjectOf(entry);

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
  writePaging(context, operation, operationObject, location);
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
  const statuses = [...new Set([...success.keys(), ...errors.keys()])].sort(
    (left, right) => left - right,
  );
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

  for (
    let request = context.pendingComponents.shift();
    request !== undefined;
    request = context.pendingComponents.shift()
  ) {
    written.set(request.key, request.build(context));
  }

  const schemas: JsonObject = {};

  for (const key of [...written.keys()].sort(compareCodeUnits)) {
    const schema = written.get(key);

    if (schema !== undefined) schemas[key] = schema;
  }

  return schemas;
}
