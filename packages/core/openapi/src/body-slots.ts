import { below, type IrLocation } from "@seampact/codegen-core";
import type { NamedTemplate, SuccessShapes, WireFormat } from "@seampact/spec/ir";
import type { EmitContext } from "./emit-context.js";
import { typeUseSchema } from "./schemas.js";
import { type SlotSchemas, type SlotValue, templateSchema } from "./templates.js";
import type { JsonObject } from "./json-value.js";

// The slots every success body may read (ADR 0002 section 13): the status, the request path, the URL of what the
// body describes, and `$meta`, the format's `meta` fields joined by a paging style's `meta` members.

const META_SLOT = "meta";
const ALWAYS_FILLED_META: readonly string[] = ["now", "handler"];

/** The response shapes the emitter writes through the format: `list` waits for a consumer (A47). */
export type EmittedShape = Exclude<keyof SuccessShapes, "list">;

export function emittedShapeOf(shape: string): EmittedShape | undefined {
  if (shape === "item" || shape === "table" || shape === "page") return shape;

  return undefined;
}

/** A URL a target writes: a relative reference, or absolute under `api.wire.urls: absolute`. */
export function urlSchema(context: EmitContext): JsonObject {
  return {
    type: "string",
    format: context.ir.api.wire.urls === "absolute" ? "uri" : "uri-reference",
  };
}

export function successSlots(context: EmitContext, status: number): Map<string, SlotValue> {
  return new Map<string, SlotValue>([
    ["status", { schema: { type: "integer", const: status }, presence: "always" }],
    ["path", { schema: { type: "string" }, presence: "always" }],
    ["self", { schema: urlSchema(context), presence: "always" }],
  ]);
}

/** `$meta`: the format's `meta` fields, then the style's `meta` members read over its response roles. */
export function addMetaSlot(
  context: EmitContext,
  slots: Map<string, SlotValue>,
  format: WireFormat,
  styleMeta: readonly NamedTemplate[],
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
      format.absent,
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
