import { below, type IrLocation } from "@seampact/codegen-core";
import { type Absent, isKnownVariant, type Template } from "@seampact/spec/ir";
import { type EmitContext, refuseNotEmitted, refuseUnknown } from "./emit-context.js";
import { copyJsonValue, type JsonObject, type JsonValue } from "./json-value.js";
import { nullableSchema } from "./schemas.js";

// A template of ADR 0002 sections 13 and 14 written out as the JSON Schema of the body it renders, from the schema
// of each slot it reads; and a route example rendered through the same template.

/** Whether a slot always has a value, may have none, or never has one here (omitted, or `null` under `absent: null`). */
export type SlotPresence = "always" | "maybe" | "never";

export interface SlotValue {
  schema: JsonObject;
  presence: SlotPresence;
}

export type SlotSchemas = ReadonlyMap<string, SlotValue>;

/** The body schema a template renders, or none when every slot it reads has no value. */
export function templateSchema(
  context: EmitContext,
  template: Template,
  slots: SlotSchemas,
  absent: Absent,
  location: IrLocation,
): SlotValue | undefined {
  if (!isKnownVariant("Template", template)) {
    refuseUnknown(context, below(location, "kind"), template.kind);

    return undefined;
  }

  switch (template.kind) {
    case "slot":
      return slotSchema(context, template.slot, template.path, slots, location);
    case "text":
      return { schema: { type: "string" }, presence: "always" };
    case "literal":
      return { schema: { const: copyJsonValue(template.value) }, presence: "always" };
    case "object":
      return objectTemplateSchema(context, template, slots, absent, location);
    case "array":
    case "each":
      refuseNotEmitted(context, `template.${template.kind}`, `A '${template.kind}' template`, location);

      return undefined;
  }
}

function slotSchema(
  context: EmitContext,
  slot: string,
  path: readonly string[],
  slots: SlotSchemas,
  location: IrLocation,
): SlotValue | undefined {
  if (path.length > 0) {
    refuseNotEmitted(context, "template.slot-path", `The slot member '$${slot}.${path.join(".")}'`, location);

    return undefined;
  }

  const value = slots.get(slot);

  if (value === undefined) {
    refuseNotEmitted(context, "template.slot", `The slot '$${slot}' in this place`, location);
  }

  return value;
}

function objectTemplateSchema(
  context: EmitContext,
  template: Extract<Template, { kind: "object" }>,
  slots: SlotSchemas,
  absent: Absent,
  location: IrLocation,
): SlotValue | undefined {
  const properties: JsonObject = {};
  const required: string[] = [];
  let presence: SlotPresence = template.members.length === 0 ? "always" : "maybe";

  template.members.forEach((member, index) => {
    const memberLocation = below(location, "members", index);

    if (!isKnownVariant("MemberName", member.name) || member.name.kind !== "text") {
      refuseNotEmitted(context, "template.member-name", "A member named by a slot", below(memberLocation, "name"));

      return;
    }

    const value = templateSchema(context, member.value, slots, absent, below(memberLocation, "value"));

    if (value === undefined) return;

    if (value.presence === "never") {
      if (absent === "null") {
        properties[member.name.text] = { type: "null" };
        required.push(member.name.text);
      }

      return;
    }

    if (value.presence === "always") presence = "always";

    const nullWhenAbsent = value.presence === "maybe" && absent === "null";

    properties[member.name.text] = nullWhenAbsent ? nullableSchema(value.schema) : value.schema;

    if (value.presence === "always" || nullWhenAbsent) required.push(member.name.text);
  });

  const schema: JsonObject = { type: "object", properties };

  if (required.length > 0) schema.required = required;

  if (template.merge === undefined) return { schema, presence };

  const merged = slotSchema(context, template.merge, [], slots, below(location, "merge"));

  if (merged === undefined || merged.presence === "never") return { schema, presence };

  return {
    schema: { allOf: [schema, merged.schema] },
    presence: merged.presence === "always" ? "always" : presence,
  };
}

/** The names of the top-level members a template writes a slot to, in order. */
export function membersWritingSlot(template: Template, slot: string): string[] {
  if (template.kind !== "object" || !("members" in template)) return [];

  return template.members.flatMap((member) => {
    const value = member.value;
    const writesSlot =
      value.kind === "slot" && "slot" in value && value.slot === slot && value.path.length === 0;

    return writesSlot && member.name.kind === "text" && "text" in member.name ? [member.name.text] : [];
  });
}

/** A route example rendered through a template whose slots are the given values; a slot without one refuses. */
export function renderTemplate(
  context: EmitContext,
  template: Template,
  values: ReadonlyMap<string, JsonValue>,
  location: IrLocation,
): JsonValue | undefined {
  if (!isKnownVariant("Template", template)) {
    refuseUnknown(context, below(location, "kind"), template.kind);

    return undefined;
  }

  switch (template.kind) {
    case "slot": {
      const value = template.path.length === 0 ? values.get(template.slot) : undefined;

      if (value === undefined) {
        refuseNotEmitted(context, "example.slot", `An example through the slot '$${template.slot}'`, location);
      }

      return value;
    }
    case "literal":
      return copyJsonValue(template.value);
    case "object":
      return renderObjectTemplate(context, template, values, location);
    default:
      refuseNotEmitted(context, "example.template", `An example through a '${template.kind}' template`, location);

      return undefined;
  }
}

function renderObjectTemplate(
  context: EmitContext,
  template: Extract<Template, { kind: "object" }>,
  values: ReadonlyMap<string, JsonValue>,
  location: IrLocation,
): JsonValue | undefined {
  if (template.merge !== undefined) {
    refuseNotEmitted(context, "example.merge", "An example through a merging template", location);

    return undefined;
  }

  const rendered: JsonObject = {};

  template.members.forEach((member, index) => {
    if (member.name.kind !== "text" || !("text" in member.name)) {
      refuseNotEmitted(context, "example.member-name", "An example through a member named by a slot", location);

      return;
    }

    const value = renderTemplate(context, member.value, values, below(location, "members", index, "value"));

    if (value !== undefined) rendered[member.name.text] = value;
  });

  return rendered;
}
