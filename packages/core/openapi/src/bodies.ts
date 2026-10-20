import { below, type IrLocation, schemaLocation } from "@seampact/codegen-core";
import {
  type FieldWire,
  type InputProof,
  isKnownVariant,
  type Operation,
  type OperationInput,
  type UnknownKeys,
} from "@seampact/spec/ir";
import {
  type EmitContext,
  reasonValue,
  refuseInconsistent,
  refuseUnknown,
  writeExtension,
} from "./emit-context.js";
import { derivedFromValue } from "./ir-text.js";
import type { JsonObject } from "./json-value.js";
import { objectSchema, typeUseSchema } from "./schemas.js";

// The `input` row of ADR 0004 section 12: the request body with its media type, its form and multipart encoding,
// its rule proofs, its unknown-key policy and its raw-body mark.

const JSON_MEDIA = "application/json";
const FORM_MEDIA = "application/x-www-form-urlencoded";
const MULTIPART_MEDIA = "multipart/form-data";
const EMPTY_BODY_SCHEMA_ID = "ApiEmptyBody";
const PASSWORD_FORMAT = "password";
const ENCODED_FIELD_KINDS: readonly string[] = ["list", "object"];

export function requestBody(
  context: EmitContext,
  operation: Operation,
  examples: JsonObject | undefined,
  location: IrLocation,
): JsonObject | undefined {
  const input = operation.input;

  if (input === undefined) return undefined;

  const inputLocation = below(location, "input");
  const mediaObject: JsonObject = { schema: bodySchema(context, input, inputLocation) };
  const encoding = bodyEncoding(context, input, inputLocation);

  if (Object.keys(encoding).length > 0) mediaObject.encoding = encoding;

  if (examples !== undefined) mediaObject.examples = examples;

  const body: JsonObject = { required: true, content: { [bodyMedia(context, operation, input)]: mediaObject } };
  const unknownKeys = input.schema.kind === "ref" && "unknownKeys" in input.schema ? input.schema.unknownKeys : undefined;

  if (unknownKeys !== undefined) writeUnknownKeys(context, body, unknownKeys, below(inputLocation, "schema"));

  if (input.rawBody) writeExtension(context, body, "raw-body", true);

  return body;
}

const KNOWN_KEY_POLICIES: readonly string[] = ["refuse", "ignore", "keep"];

// An ignoring or keeping input states it with its reason; refusing unknown keys is what every reader assumes.
function writeUnknownKeys(
  context: EmitContext,
  body: JsonObject,
  unknownKeys: UnknownKeys,
  location: IrLocation,
): void {
  if (!KNOWN_KEY_POLICIES.includes(unknownKeys.policy)) {
    refuseUnknown(context, below(location, "unknownKeys", "policy"), unknownKeys.policy);

    return;
  }

  if (unknownKeys.policy === "refuse") return;

  const reason = unknownKeys.reason === undefined ? true : reasonValue(context, unknownKeys.reason);

  writeExtension(context, body, "unknown-keys", { [unknownKeys.policy]: reason });
}

// A JSON body takes the operation format's media type; a form or multipart body keeps its own.
function bodyMedia(context: EmitContext, operation: Operation, input: OperationInput): string {
  if (input.media !== JSON_MEDIA) return input.media;

  return context.ir.formats[operation.format]?.media ?? input.media;
}

function bodySchema(context: EmitContext, input: OperationInput, location: IrLocation): JsonObject {
  const proofs = input.proofs ?? [];

  if (proofs.length === 0) return typeUseSchema(context, input.schema, "input", below(location, "schema"));

  const strict = context.options.inputSchemas === "strict";
  const proofObject = proofsSchema(context, proofs, below(location, "proofs"));
  const inputSchemaId = input.schema.kind === "ref" && "schema" in input.schema ? input.schema.schema : undefined;

  if (inputSchemaId === EMPTY_BODY_SCHEMA_ID) {
    if (strict) proofObject.unevaluatedProperties = false;

    return proofObject;
  }

  const wrapper: JsonObject = { allOf: [inputTopLevel(context, input, inputSchemaId, location), proofObject] };

  if (strict) wrapper.unevaluatedProperties = false;

  return wrapper;
}

// Under strict input the body wrapper refuses unknown keys through `unevaluatedProperties`, so the input object
// is written in place without its own `additionalProperties: false`, which would refuse the proofs.
function inputTopLevel(
  context: EmitContext,
  input: OperationInput,
  inputSchemaId: string | undefined,
  location: IrLocation,
): JsonObject {
  const named = inputSchemaId === undefined ? undefined : context.ir.schemas[inputSchemaId];

  if (inputSchemaId === undefined || named === undefined || !isKnownVariant("Schema", named) || named.kind !== "object") {
    refuseInconsistent(context, "input.proofs", "A body proof on an input that is not an object schema", location);

    return {};
  }

  if (context.options.inputSchemas !== "strict") {
    return typeUseSchema(context, input.schema, "input", below(location, "schema"));
  }

  const topLevel = objectSchema(context, named, "input", schemaLocation(inputSchemaId));

  delete topLevel.additionalProperties;

  return topLevel;
}

function proofsSchema(context: EmitContext, proofs: readonly InputProof[], location: IrLocation): JsonObject {
  const properties: JsonObject = {};

  proofs.forEach((proof, index) => {
    const schema = typeUseSchema(context, proof.schema, "input", below(location, index, "schema"));

    // Every proof is sensitive (ADR 0002 section 9).
    if (typeof schema.type === "string") schema.format = PASSWORD_FORMAT;

    writeExtension(context, schema, "derived-from", derivedFromValue(proof.derivedFrom));
    properties[proof.name] = schema;
  });

  return { type: "object", properties, required: proofs.map((proof) => proof.name) };
}

// A form body encodes each list or object field with its style; a multipart body states each file part's media.
function bodyEncoding(context: EmitContext, input: OperationInput, location: IrLocation): JsonObject {
  const encoding: JsonObject = {};

  if (input.media === FORM_MEDIA) {
    const fields = [...(input.fields ?? []), ...(input.proofs ?? []).flatMap(proofField)];

    for (const field of fields) {
      if (ENCODED_FIELD_KINDS.includes(field.wire.kind)) {
        encoding[field.name] = { style: field.wire.style ?? "form", explode: field.wire.explode ?? true };
      }
    }
  }

  if (input.media === MULTIPART_MEDIA) {
    for (const field of input.fields ?? []) {
      const media = field.wire.kind === "file" ? fileFieldMedia(context, input, field.name, location) : undefined;

      if (media !== undefined && media.length > 0) encoding[field.name] = { contentType: media.join(", ") };
    }
  }

  return encoding;
}

function proofField(proof: InputProof): { name: string; wire: FieldWire }[] {
  return proof.wire === undefined ? [] : [{ name: proof.name, wire: proof.wire }];
}

function fileFieldMedia(
  context: EmitContext,
  input: OperationInput,
  fieldName: string,
  location: IrLocation,
): readonly string[] | undefined {
  const schemaId = input.schema.kind === "ref" && "schema" in input.schema ? input.schema.schema : undefined;
  const named = schemaId === undefined ? undefined : context.ir.schemas[schemaId];
  const property =
    named !== undefined && isKnownVariant("Schema", named) && named.kind === "object"
      ? named.properties.find((candidate) => candidate.name === fieldName)
      : undefined;

  if (property === undefined || property.type.kind !== "file" || !("media" in property.type)) {
    refuseInconsistent(context, "input.file", `The file field '${fieldName}' has no file property`, location);

    return undefined;
  }

  return property.type.media;
}
