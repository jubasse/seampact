import { below, type IrLocation } from "@seampact/codegen-core";
import type { Operation, Response, ResponseHeader, WireFormat } from "@seampact/spec/ir";
import { addMetaSlot, emittedShapeOf, successSlots } from "./body-slots.js";
import {
  type EmitContext,
  refuseInconsistent,
  refuseNotEmitted,
  writeExtension,
} from "./emit-context.js";
import { type ExampleSet, responseExamples } from "./examples.js";
import { isJsonObject, type JsonObject } from "./json-value.js";
import { pageBodySchema } from "./paging.js";
import { typeUseSchema } from "./schemas.js";
import { templateSchema } from "./templates.js";

// The `responses` row of ADR 0004 section 12, with the headers the `cache`, `degradable` and `deprecated` rows add:
// each success response with its body written out through the format's shape around the payload schema.

const PAYLOAD_SLOT = "payload";
const SUCCESSOR_LINK_SEMANTIC = "successorLink";
const CACHE_CONTROL_HEADER = "Cache-Control";
const SUCCESS_STATUS_LIMIT = 300;
const REDIRECT_STATUS_LIMIT = 400;
const NOT_MODIFIED_STATUS = 304;

export function successResponses(
  context: EmitContext,
  operation: Operation,
  examples: ExampleSet,
  location: IrLocation,
): Map<number, JsonObject> {
  const responses = new Map<number, JsonObject>();
  const format = context.ir.formats[operation.format];

  if (format === undefined) {
    refuseInconsistent(
      context,
      "format.missing",
      `The format '${operation.format}' is not declared`,
      location,
    );

    return responses;
  }

  operation.responses.forEach((response, index) => {
    const responseLocation = below(location, "responses", index);
    const responseObject = successResponse(context, operation, format, response, responseLocation);
    const content = responseObject.content;
    const statusExamples = responseExamples(context, format, response, examples, responseLocation);

    if (statusExamples !== undefined && isJsonObject(content) && response.media !== undefined) {
      const mediaObject = content[response.media];

      if (isJsonObject(mediaObject)) mediaObject.examples = statusExamples;
    }

    responses.set(response.status, responseObject);
  });

  return responses;
}

function successResponse(
  context: EmitContext,
  operation: Operation,
  format: WireFormat,
  response: Response,
  location: IrLocation,
): JsonObject {
  const responseObject: JsonObject = { description: responseDescription(response) };
  const headers = responseHeaders(context, operation, response, location);

  if (Object.keys(headers).length > 0) responseObject.headers = headers;

  const body = responseBodySchema(context, operation, format, response, location);

  if (body !== undefined && response.media !== undefined) {
    responseObject.content = { [response.media]: { schema: body } };
  }

  return responseObject;
}

function responseDescription(response: Response): string {
  const written = response.docs?.description ?? response.docs?.summary;

  if (written !== undefined) return written;

  if (response.status < SUCCESS_STATUS_LIMIT) return "Success.";

  return response.status < REDIRECT_STATUS_LIMIT ? "Redirection." : "Response.";
}

function responseBodySchema(
  context: EmitContext,
  operation: Operation,
  format: WireFormat,
  response: Response,
  location: IrLocation,
): JsonObject | undefined {
  if (response.shape === "empty" || response.shape === "redirect") return undefined;

  const shape = emittedShapeOf(response.shape);

  if (shape === undefined) {
    refuseNotEmitted(
      context,
      "response.shape",
      `A '${response.shape}' response`,
      below(location, "shape"),
    );

    return undefined;
  }

  if (response.body === undefined) {
    refuseInconsistent(context, "response.body", `A '${shape}' response has no body`, location);

    return undefined;
  }

  if (format.success[shape].headers.length > 0) {
    refuseNotEmitted(
      context,
      "format.success.headers",
      "A success header written by the format",
      below({ member: "" }, "formats", format.id, "success", shape, "headers"),
    );
  }

  const payload = typeUseSchema(context, response.body, "shared", below(location, "body"));

  if (shape === "page") {
    return pageBodySchema(context, operation, format, payload, response.status, location);
  }

  const slots = successSlots(context, response.status);
  const payloadSchema =
    shape === "table" ? { type: "object", additionalProperties: payload } : payload;

  slots.set(PAYLOAD_SLOT, { schema: payloadSchema, presence: "always" });

  const formatLocation = below({ member: "" }, "formats", format.id, "success", shape, "body");

  addMetaSlot(context, slots, format, [], new Map(), formatLocation);

  return templateSchema(context, format.success[shape].body, slots, format.absent, formatLocation)
    ?.schema;
}

function responseHeaders(
  context: EmitContext,
  operation: Operation,
  response: Response,
  location: IrLocation,
): JsonObject {
  const headers: JsonObject = {};

  response.headers.forEach((header, index) => {
    headers[header.name] = headerObject(
      context,
      operation,
      header,
      below(location, "headers", index),
    );
  });

  const success = response.status < SUCCESS_STATUS_LIMIT || response.status === NOT_MODIFIED_STATUS;

  if (operation.cache !== undefined && success) {
    const values = operation.cache.perCallerKind.map((entry) => entry.cacheControl);
    const perCaller: JsonObject = {};

    for (const entry of operation.cache.perCallerKind) perCaller[entry.caller] = entry.cacheControl;

    const header: JsonObject = { schema: { type: "string", enum: [...new Set(values)] } };

    writeExtension(context, header, "cache-control", perCaller);
    headers[CACHE_CONTROL_HEADER] = header;
  }

  const degradedHeader = operation.degradable?.header;

  if (degradedHeader !== undefined && response.status < SUCCESS_STATUS_LIMIT) {
    headers[degradedHeader] = { schema: { type: "string" } };
  }

  return headers;
}

function headerObject(
  context: EmitContext,
  operation: Operation,
  header: ResponseHeader,
  location: IrLocation,
): JsonObject {
  const headerObject: JsonObject = {};

  if (
    header.semantic === SUCCESSOR_LINK_SEMANTIC &&
    operation.deprecated?.successorRel !== undefined
  ) {
    headerObject.description = `The successor operation, with rel "${operation.deprecated.successorRel}".`;
  }

  if (header.required) headerObject.required = true;

  headerObject.schema = typeUseSchema(context, header.type, "shared", below(location, "type"));

  if (header.semantic !== undefined)
    writeExtension(context, headerObject, "semantic", header.semantic);

  return headerObject;
}
