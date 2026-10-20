import type { ContractIR, Operation, Response, Template } from "@seampact/spec/ir";
import { below, type IrLocation } from "../ir-location.js";
import { refuseInconsistentIr, refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";
import { absentRendering, slotPath, templateSlots } from "./paging-entry.js";
import { type SourceValue, template } from "./route-table-source.js";

// The success body around a handler's payload (ADR 0002 section 13): an item, list or table response written in its
// format's envelope, `{ data: $payload }` for Laravel, and where the payload or a page's items sit in the body.

const API_LOCATION: IrLocation = { member: "" };
const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";

// The slots an item, list or table envelope may write that the boundary fills; `$meta` is the format's, empty
// while format meta members are refused.
const RENDERED_ENVELOPE_SLOTS: readonly string[] = [PAYLOAD_SLOT, "status", "path", "meta"];

/** The response entry members of a body's envelope: the template, undefined when bare, and the payload's path. */
export function successEnvelope(
  ir: ContractIR,
  operation: Operation,
  response: Response,
  pageBody: Template | undefined,
  refusals: Refusal[],
): { readonly envelope?: SourceValue; readonly payloadPath: readonly string[] } {
  const format = Object.hasOwn(ir.formats, operation.format)
    ? ir.formats[operation.format]
    : undefined;
  const formatLocation = below(API_LOCATION, "formats", operation.format);

  if (format === undefined || response.body === undefined || response.shape === "empty") {
    return { payloadPath: [] };
  }

  if (Object.keys(format.meta).length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.meta",
        "The format's meta members",
        below(formatLocation, "meta"),
      ),
    );
  }

  if (response.shape === "page") return pageItemsPath(pageBody, formatLocation, refusals);

  const shapeLocation = below(formatLocation, "success", response.shape);
  const shape = shapeOf(format.success, response.shape);

  if (shape === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "format.success.shape",
        `The format has no '${response.shape}' success shape`,
        shapeLocation,
      ),
    );

    return { payloadPath: [] };
  }

  if (shape.headers.length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.success.headers",
        "A success format header",
        below(shapeLocation, "headers"),
      ),
    );
  }

  return envelopeOf(
    shape.body,
    absentRendering(format.absent, below(formatLocation, "absent"), refusals),
    below(shapeLocation, "body"),
    refusals,
  );
}

function shapeOf(success: ContractIR["formats"][string]["success"], shape: string) {
  switch (shape) {
    case "item":
      return success.item;
    case "table":
      return success.table;
    case "list":
      return success.list;
    default:
      return undefined;
  }
}

function envelopeOf(
  body: Template,
  absent: string,
  location: IrLocation,
  refusals: Refusal[],
): { readonly envelope?: SourceValue; readonly payloadPath: readonly string[] } {
  const payloadPath = slotPath(body, PAYLOAD_SLOT);

  if (payloadPath === undefined) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.success.envelope",
        "A success envelope that does not write `$payload` under named members",
        location,
      ),
    );

    return { payloadPath: [] };
  }

  if (payloadPath.length === 0) return { payloadPath };

  for (const slot of templateSlots(body)) {
    if (RENDERED_ENVELOPE_SLOTS.includes(slot)) continue;

    refusals.push(
      refuseNotGeneratedYet(
        "format.success.slot",
        `The success envelope slot '$${slot}'`,
        location,
      ),
    );
  }

  return { envelope: { body: template(body, location, refusals), absent }, payloadPath };
}

function pageItemsPath(
  pageBody: Template | undefined,
  formatLocation: IrLocation,
  refusals: Refusal[],
): { readonly payloadPath: readonly string[] } {
  const itemsPath = pageBody === undefined ? undefined : slotPath(pageBody, ITEMS_SLOT);

  if (itemsPath !== undefined) return { payloadPath: itemsPath };

  refusals.push(
    refuseNotGeneratedYet(
      "paging.response.items",
      "A page body that does not write `$items` under named members",
      below(formatLocation, "success", "page"),
    ),
  );

  return { payloadPath: [] };
}
