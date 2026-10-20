import { below, type IrLocation } from "@seampact/codegen-core";
import type { ErrorDecl, Operation, OperationError, WireFormat } from "@seampact/spec/ir";
import {
  type EmitContext,
  referenceComponent,
  refuseInconsistent,
  refuseNotEmitted,
  writeExtension,
} from "./emit-context.js";
import { originKey } from "./ir-text.js";
import { compareCodeUnits, type JsonObject } from "./json-value.js";
import { schemaReference, writeDocs } from "./schemas.js";
import { membersWritingSlot, type SlotValue, templateSchema } from "./templates.js";

// The `errors` row of ADR 0004 section 12: one response per error status listing its codes, each code a
// component of the format's error body for its params, named by the code, with `x-seampact-nature`.

const CODE_SLOT = "code";
const PARAMS_SLOT = "params";
const RATE_LIMITED_STATUS = 429;

interface StatusCodes {
  status: number;
  errors: { error: OperationError; index: number; declared: ErrorDecl }[];
}

export function errorResponses(
  context: EmitContext,
  operation: Operation,
  location: IrLocation,
): Map<number, JsonObject> {
  const responses = new Map<number, JsonObject>();
  const format = context.ir.formats[operation.format];

  // The success responses refused a missing format already.
  if (format === undefined) return responses;

  if (format.error.headers.length > 0) {
    refuseNotEmitted(
      context,
      "format.error.headers",
      "An error header written by the format",
      below({ member: "" }, "formats", format.id, "error", "headers"),
    );
  }

  for (const group of codesByStatus(context, operation, location)) {
    responses.set(group.status, errorResponse(context, format, group, location));
  }

  return responses;
}

function codesByStatus(context: EmitContext, operation: Operation, location: IrLocation): StatusCodes[] {
  const groups = new Map<number, StatusCodes>();

  operation.errors.forEach((error, index) => {
    const declared = context.ir.errors[error.code];

    if (declared === undefined) {
      refuseInconsistent(
        context,
        "error.missing",
        `The error code '${error.code}' is not declared`,
        below(location, "errors", index),
      );

      return;
    }

    const status = declared.http.status;
    const group = groups.get(status) ?? { status, errors: [] };

    group.errors.push({ error, index, declared });
    groups.set(status, group);
  });

  for (const group of groups.values()) {
    group.errors.sort((left, right) => compareCodeUnits(left.error.code, right.error.code));
  }

  return [...groups.values()].sort((left, right) => left.status - right.status);
}

function errorResponse(
  context: EmitContext,
  format: WireFormat,
  group: StatusCodes,
  location: IrLocation,
): JsonObject {
  const references = group.errors.map(({ declared }) => errorCodeReference(context, format, declared));
  const schema: JsonObject = references.length === 1 && references[0] !== undefined ? references[0] : { oneOf: references };
  const discriminatorMember = membersWritingSlot(format.error.body, CODE_SLOT).at(-1);

  if (references.length > 1 && discriminatorMember !== undefined) {
    schema.discriminator = { propertyName: discriminatorMember };
  }

  const response: JsonObject = {
    description: group.errors.map(({ error }) => error.code).join(", "),
  };
  const headers = retryHeaders(group);

  if (Object.keys(headers).length > 0) response.headers = headers;

  response.content = { [format.error.media]: { schema } };
  writeExtension(
    context,
    response,
    "errors",
    group.errors.map(({ error, index }) => errorItem(context, error, below(location, "errors", index))),
  );

  return response;
}

function errorItem(context: EmitContext, error: OperationError, location: IrLocation): JsonObject {
  const item: JsonObject = { code: error.code };

  if (error.derivedFrom !== undefined) {
    item.derivedFrom = error.derivedFrom.derivation;
  } else if (error.origin !== undefined) {
    item.origin = originKey(error.origin);
  } else {
    refuseInconsistent(context, "error.provenance", "An operation error with neither derivedFrom nor origin", location);
  }

  return item;
}

// A 429 of a bucket rule names its retry header: a whole number of seconds or milliseconds.
function retryHeaders(group: StatusCodes): JsonObject {
  const headers: JsonObject = {};

  if (group.status !== RATE_LIMITED_STATUS) return headers;

  for (const { error } of group.errors) {
    if (error.retryHeader === undefined) continue;

    headers[error.retryHeader.name] = { schema: { type: "integer", minimum: 0 } };
  }

  return headers;
}

function errorCodeReference(context: EmitContext, format: WireFormat, declared: ErrorDecl): JsonObject {
  const known = context.errorCodeFormats.get(declared.code);

  if (known !== undefined && known !== format.id) {
    refuseNotEmitted(
      context,
      "error.formats",
      `The code '${declared.code}' answered in the formats '${known}' and '${format.id}' in one document`,
      below({ member: "" }, "errors", declared.code),
    );
  }

  context.errorCodeFormats.set(declared.code, format.id);

  return referenceComponent(context, {
    key: declared.code,
    build: (buildContext) => errorCodeComponent(buildContext, format, declared),
  });
}

/** The format's error body for one code: its code and status as constants, its params schema merged or nested. */
function errorCodeComponent(context: EmitContext, format: WireFormat, declared: ErrorDecl): JsonObject {
  const always = (schema: JsonObject): SlotValue => ({ schema, presence: "always" });
  const maybe = (schema: JsonObject): SlotValue => ({ schema, presence: "maybe" });
  const params =
    declared.params === undefined
      ? { schema: {}, presence: "never" as const }
      : always(schemaReference(context, declared.params, "shared"));
  const slots = new Map<string, SlotValue>([
    [CODE_SLOT, always({ type: "string", const: declared.code })],
    ["title", always({ type: "string" })],
    ["status", always({ type: "integer", const: declared.http.status })],
    ["nature", always({ type: "string" })],
    ["detail", maybe({ type: "string" })],
    ["instance", maybe({ type: "string" })],
    ["traceId", maybe({ type: "string" })],
    [PARAMS_SLOT, params],
  ]);
  const location = below({ member: "" }, "formats", format.id, "error", "body");
  const schema = templateSchema(context, format.error.body, slots, format.absent, location)?.schema ?? {};

  writeDocs(schema, declared.docs);

  const nature: JsonObject = { base: declared.nature };

  if (declared.natureName !== undefined) nature.name = declared.natureName;

  writeExtension(context, schema, "nature", nature);

  return schema;
}
