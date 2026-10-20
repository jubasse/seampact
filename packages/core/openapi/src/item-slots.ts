import { below, type IrLocation } from "@seampact/codegen-core";
import { isKnownVariant, type Operation, type TypeUse } from "@seampact/spec/ir";
import type { EmitContext } from "./emit-context.js";
import type { JsonObject } from "./json-value.js";
import { propertySchema, typeUseSchema } from "./schemas.js";
import type { SlotSchemas, SlotValue } from "./templates.js";

// The slots that read one record of a collection (ADR 0002 section 13): its id and the record without its id member.
// A record without the id property fills neither, so a template that reads one refuses by name.

export interface RecordSlots {
  id: SlotValue;
  fields: SlotValue;
}

/** The id property's schema, and the record's other properties as an object, or none when the record has no such property. */
export function recordSlots(
  context: EmitContext,
  operation: Operation,
  record: TypeUse,
  location: IrLocation,
): RecordSlots | undefined {
  const idProperty = operation.resource?.idProperty ?? operation.resource?.idParam;
  const named =
    record.kind === "ref" && "schema" in record ? context.ir.schemas[record.schema] : undefined;

  if (idProperty === undefined || named === undefined) return undefined;

  if (!isKnownVariant("Schema", named) || named.kind !== "object") return undefined;

  const id = named.properties.find((property) => property.name === idProperty);

  if (id === undefined) return undefined;

  const properties: JsonObject = {};
  const required: string[] = [];

  named.properties.forEach((property, index) => {
    if (property === id) return;

    properties[property.name] = propertySchema(
      context,
      property,
      "shared",
      below(location, "properties", index),
    );

    if (!property.optional) required.push(property.name);
  });

  const fields: JsonObject = { type: "object", properties };

  if (required.length > 0) fields.required = required;

  return {
    id: {
      schema: typeUseSchema(context, id.type, "shared", below(location, "id")),
      presence: "always",
    },
    fields: { schema: fields, presence: "always" },
  };
}

/** The slots inside `$as` over the records of a page: the record, its id, its other members and its member URL. */
export function elementSlots(
  slots: SlotSchemas,
  record: SlotValue,
  fromRecord: RecordSlots | undefined,
  memberUrl: SlotValue,
): SlotSchemas {
  const element = new Map(slots);

  element.set("item", record);
  element.set("itemSelf", memberUrl);

  if (fromRecord !== undefined) {
    element.set("itemId", fromRecord.id);
    element.set("itemFields", fromRecord.fields);
  }

  return element;
}
