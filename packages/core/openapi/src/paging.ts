import { below, type IrLocation } from "@seampact/codegen-core";
import type { Operation, TypeUse, WireFormat } from "@seampact/spec/ir";
import { addMetaSlot, successSlots, urlSchema } from "./body-slots.js";
import {
  type EmitContext,
  refuseInconsistent,
  refuseNotEmitted,
  writeExtension,
} from "./emit-context.js";
import { valueSourceText } from "./ir-text.js";
import { elementSlots, recordSlots } from "./item-slots.js";
import { copyOptional, type JsonObject, type JsonValue, setDefined } from "./json-value.js";
import { type SlotValue, templateSchema } from "./templates.js";

// The paging row of ADR 0004 section 12: `x-seampact-paging` on a list operation, the default of the limit
// parameter, and the page body a style and the format write around the items.

const LIMIT_ROLE = "limit";
const ITEMS_SLOT = "items";
const INSTANT_TOKEN = "instant";

export function writePaging(
  context: EmitContext,
  operation: Operation,
  target: JsonObject,
  location: IrLocation,
): void {
  const paging = operation.paging;

  if (paging === undefined) return;

  const pagingLocation = below(location, "paging");

  if (paging.style === undefined) {
    writeExtension(context, target, "paging", { none: true });

    return;
  }

  const style = context.ir.pagings[paging.style];

  if (style === undefined) {
    refuseInconsistent(
      context,
      "paging.style",
      `The paging style '${paging.style}' is not declared`,
      below(pagingLocation, "style"),
    );

    return;
  }

  const value: JsonObject = { style: paging.style, position: style.position };
  const roles: JsonObject = {};
  const styleLocation = below({ member: "" }, "pagings", paging.style);

  style.request.forEach((role, index) => {
    roles[role.role] = valueSourceText(
      context,
      { in: role.in, name: role.name },
      below(styleLocation, "request", index),
    );
  });

  value.roles = roles;

  setDefined(value, "maxLimit", paging.maxLimit);
  setDefined(value, "defaultLimit", paging.defaultLimit);
  value.overLimit = paging.overLimit;
  setDefined(value, "token", paging.token);
  value.sortKeys = paging.sortKeys.map((sortKey, index) => {
    const item: JsonObject = { key: sortKey.key };

    setDefined(item, "right", sortKey.right);
    setDefined(item, "params", copyOptional(sortKey.params));
    setDefined(
      item,
      "subject",
      sortKey.subject &&
        valueSourceText(
          context,
          sortKey.subject.source,
          below(pagingLocation, "sortKeys", index, "subject", "source"),
        ),
    );

    return item;
  });

  writeExtension(context, target, "paging", value);
}

/** The `default` of the style's limit parameter: the route's `defaultLimit`. */
export function pagingLimitDefault(
  context: EmitContext,
  operation: Operation,
  place: string,
  name: string,
): JsonValue | undefined {
  const paging = operation.paging;
  const style = paging?.style === undefined ? undefined : context.ir.pagings[paging.style];
  const limitRole = style?.request.find((role) => role.role === LIMIT_ROLE);

  if (limitRole === undefined || limitRole.in !== place || limitRole.name !== name)
    return undefined;

  return paging?.defaultLimit;
}

/** The body of a page: the style's own body, or the format's page shape with the style's `meta` members. */
export function pageBodySchema(
  context: EmitContext,
  operation: Operation,
  format: WireFormat,
  itemUse: TypeUse,
  itemSchema: JsonObject,
  status: number,
  location: IrLocation,
): JsonObject | undefined {
  const style =
    operation.paging?.style === undefined ? undefined : context.ir.pagings[operation.paging.style];

  if (style === undefined) {
    refuseInconsistent(context, "page.style", "A page response without a paging style", location);

    return undefined;
  }

  if (style.response.headers.length > 0) {
    refuseNotEmitted(
      context,
      "paging.headers",
      "A paging style header",
      below({ member: "" }, "pagings", style.id, "response", "headers"),
    );
  }

  const roleSlots = pagingRoleSlots(context, operation.paging?.token);
  const slots = successSlots(context, operation, status, itemUse);

  for (const [slot, value] of roleSlots) slots.set(slot, value);

  const record: SlotValue = { schema: itemSchema, presence: "always" };
  const memberUrl: SlotValue = { schema: urlSchema(context), presence: "always" };

  slots.set(ITEMS_SLOT, {
    schema: { type: "array", items: itemSchema },
    presence: "always",
    element: elementSlots(
      slots,
      record,
      recordSlots(context, operation, itemUse, below(location, "body")),
      memberUrl,
    ),
  });

  const styleLocation = below({ member: "" }, "pagings", style.id, "response");
  const body = style.response.body;

  addMetaSlot(
    context,
    slots,
    format,
    body === undefined ? style.response.meta : [],
    roleSlots,
    styleLocation,
  );

  const template = body ?? format.success.page.body;
  const templateLocation =
    body === undefined
      ? below({ member: "" }, "formats", format.id, "success", "page", "body")
      : below(styleLocation, "body");

  return templateSchema(context, template, slots, format.absent, templateLocation)?.schema;
}

// The response roles of section 14, each the slot of its name.
function pagingRoleSlots(context: EmitContext, token: string | undefined): Map<string, SlotValue> {
  const integer: SlotValue = { schema: { type: "integer" }, presence: "always" };
  const always = (schema: JsonObject): SlotValue => ({ schema, presence: "always" });
  const maybe = (schema: JsonObject): SlotValue => ({ schema, presence: "maybe" });
  const since: JsonObject =
    token === INSTANT_TOKEN ? { type: "string", format: "date-time" } : { type: "string" };

  return new Map<string, SlotValue>([
    ["nextCursor", maybe({ type: "string" })],
    ["previousCursor", maybe({ type: "string" })],
    ["more", always({ type: "boolean" })],
    ["page", integer],
    ["offset", integer],
    ["limit", integer],
    ["from", integer],
    ["to", integer],
    ["total", integer],
    ["totalPages", integer],
    ["first", always(urlSchema(context))],
    ["previous", maybe(urlSchema(context))],
    ["next", maybe(urlSchema(context))],
    ["last", always(urlSchema(context))],
    ["nextSince", always(since)],
    ["complete", always({ type: "boolean" })],
  ]);
}
