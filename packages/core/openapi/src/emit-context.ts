import type { IrLocation, Refusal } from "@seampact/codegen-core";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type { ContractIR, Extensions, SchemeId } from "@seampact/spec/ir";
import type { EmitterOptions } from "./emitter-options.js";
import { ALL_EXTENSIONS, NO_EXTENSIONS } from "./emitter-options.js";
import { EXTENSION_PREFIX, type ExtensionName } from "./extension-names.js";
import { copyJsonValue, type JsonObject, type JsonValue } from "./json-value.js";

// What every mapping module of one document shares: the IR, the options, the refusals, and the components and
// security schemes the document's operations reference, written once the operations are done.

/** A named schema as a document writes it: the shared component, or its strict `<name>.input` twin. */
export type SchemaVariant = "shared" | "input";

export interface ComponentRequest {
  key: string;
  build: (context: EmitContext) => JsonObject;
}

export interface EmitContext {
  ir: ContractIR;
  options: EmitterOptions;
  refusals: Refusal[];
  /** The `components.schemas` keys referenced so far, each with the function that writes it. */
  schemaComponents: Map<string, ComponentRequest>;
  /** Components referenced but not written yet. */
  pendingComponents: ComponentRequest[];
  securitySchemes: Set<SchemeId>;
  /** The format each error code component is written in; one document holds one body per code. */
  errorCodeFormats: Map<string, string>;
}

export function createEmitContext(ir: ContractIR, options: EmitterOptions): EmitContext {
  return {
    ir,
    options,
    refusals: [],
    schemaComponents: new Map(),
    pendingComponents: [],
    securitySchemes: new Set(),
    errorCodeFormats: new Map(),
  };
}

export const COMPONENT_SCHEMA_PREFIX = "#/components/schemas/";

/** A `$ref` to a component schema, which the document then writes. */
export function referenceComponent(context: EmitContext, request: ComponentRequest): JsonObject {
  if (!context.schemaComponents.has(request.key)) {
    context.schemaComponents.set(request.key, request);
    context.pendingComponents.push(request);
  }

  return { $ref: `${COMPONENT_SCHEMA_PREFIX}${request.key}` };
}

/** Writes `x-seampact-<name>` when the `extensions` option keeps it. */
export function writeExtension(
  context: EmitContext,
  target: JsonObject,
  name: ExtensionName,
  value: JsonValue,
): void {
  const selection = context.options.extensions;

  if (selection === NO_EXTENSIONS) return;

  if (selection !== ALL_EXTENSIONS && !selection.includes(name)) return;

  target[`${EXTENSION_PREFIX}${name}`] = value;
}

/** A reason as an extension writes it: the text, or `true` under `reasons: omit`, so the member keeps its meaning. */
export function reasonValue(context: EmitContext, reason: string): string | true {
  return context.options.reasons === "omit" ? true : reason;
}

/** A reason member that is not the whole meaning of its object, left out under `reasons: omit`. */
export function optionalReason(
  context: EmitContext,
  reason: string | undefined,
): string | undefined {
  return context.options.reasons === "omit" ? undefined : reason;
}

/** Writes the consumer extension keys of an element as `x-<prefix>-<key>` (ADR 0002 section 12). */
export function writeConsumerExtensions(target: JsonObject, extensions: Extensions): void {
  for (const [prefix, keys] of Object.entries(extensions)) {
    for (const [key, value] of Object.entries(keys)) {
      target[`x-${prefix}-${key}`] = copyJsonValue(value);
    }
  }
}

export function refuseUnknown(context: EmitContext, location: IrLocation, value: string): void {
  context.refusals.push(refuseUnknownValueAt(location, value));
}

export function refuseNotEmitted(
  context: EmitContext,
  form: string,
  description: string,
  location: IrLocation,
): void {
  context.refusals.push(refuseNotGeneratedYet(`openapi.${form}`, description, location));
}

export function refuseInconsistent(
  context: EmitContext,
  code: string,
  description: string,
  location: IrLocation,
): void {
  context.refusals.push(refuseInconsistentIr(`openapi.${code}`, description, location));
}
