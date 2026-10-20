import { below, type IrLocation } from "@seampact/codegen-core";
import {
  type Absent,
  isKnownVariant,
  type NamedTemplate,
  type Operation,
  type SuccessShapes,
  type TypeUse,
  type WireFormat,
} from "@seampact/spec/ir";
import type { EmitContext } from "./emit-context.js";
import type { JsonObject } from "./json-value.js";
import { typeUseSchema } from "./schemas.js";
import { type SlotSchemas, type SlotValue, templateSchema } from "./templates.js";

// The slots every success body may read (ADR 0002 section 13): the status, the request path, the URL of what the
// body describes, and `$meta`, the format's `meta` fields joined by a paging style's `meta` members.

const META_SLOT = "meta";
const COLLECTION_SLOT = "collection";
const RESOURCE_SLOT = "resource";
const ALWAYS_FILLED_META: readonly string[] = ["now", "handler"];

/** The response shapes the emitter writes through the format. */
export type EmittedShape = keyof SuccessShapes;

export function emittedShapeOf(shape: string): EmittedShape | undefined {
  if (shape === "item" || shape === "table" || shape === "list" || shape === "page") return shape;

  return undefined;
}

/** A URL a target writes: a relative reference, or absolute under `api.wire.urls: absolute`. */
export function urlSchema(context: EmitContext): JsonObject {
  return {
    type: "string",
    format: context.ir.api.wire.urls === "absolute" ? "uri" : "uri-reference",
  };
}

export function successSlots(
  context: EmitContext,
  operation: Operation,
  status: number,
  item: TypeUse,
): Map<string, SlotValue> {
  const slots = new Map<string, SlotValue>([
    ["status", { schema: { type: "integer", const: status }, presence: "always" }],
    ["path", { schema: { type: "string" }, presence: "always" }],
    ["self", { schema: urlSchema(context), presence: "always" }],
  ]);

  // `$collection` is the resource type the IR fixes per operation; a route of no resource has no value for it.
  if (operation.resource !== undefined)
    slots.set(COLLECTION_SLOT, {
      schema: { const: operation.resource.type },
      presence: "always",
    });

  const resource = resourceName(context, item);

  if (resource !== undefined)
    slots.set(RESOURCE_SLOT, { schema: { const: resource }, presence: "always" });

  return slots;
}

// `$resource` is the item schema's `typeName`, else its name (ADR 0002 section 13); a payload that is no named object has none.
function resourceName(context: EmitContext, item: TypeUse): string | undefined {
  if (item.kind !== "ref" || !("schema" in item)) return undefined;

  const named = context.ir.schemas[item.schema];

  if (named === undefined || !isKnownVariant("Schema", named) || named.kind !== "object")
    return undefined;

  return named.typeName ?? item.schema;
}

/** `$meta`: the format's `meta` fields, then the style's `meta` members read over its response roles. */
export function addMetaSlot(
  context: EmitContext,
  slots: Map<string, SlotValue>,
  format: WireFormat,
  styleMeta: readonly NamedTemplate[],
  styleAbsent: Absent,
  roleSlots: SlotSchemas,
  location: IrLocation,
): void {
  const properties: JsonObject = {};
  const required: string[] = [];

  for (const [name, member] of Object.entries(format.meta)) {
    properties[name] = typeUseSchema(
      context,
      member.type,
      "shared",
      below({ member: "" }, "formats", format.id, "meta", name, "type"),
    );

    if (ALWAYS_FILLED_META.includes(member.fill)) required.push(name);
  }

  styleMeta.forEach((member, index) => {
    const value = templateSchema(
      context,
      member.value,
      roleSlots,
      styleAbsent,
      below(location, "meta", index),
    );

    if (value === undefined) return;

    properties[member.name] = value.schema;

    if (value.presence === "always") required.push(member.name);
  });

  const schema: JsonObject = { type: "object", properties };

  if (required.length > 0) schema.required = required;

  slots.set(META_SLOT, { schema, presence: "always" });
}
