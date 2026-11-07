import type { IrWriter } from "@seampact/spec/ir";
import {
  type TemplateSite,
  type TemplateSlot,
  type TemplateSlotKind,
  templateRead,
} from "../../../templates/index.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { type TreeNodesContext, type TreeNodesJson, treeNodesOriginAt } from "./raw.js";

// The templates of format shapes and paging styles (ADR 0002 sections 13 and 14): the closed slot catalogue of each
// place a template is written in, given to the shared template reader with a reporter of tree.nodes rules.

/** Where a template is written, which sets the slots it may use. */
export type TreeNodesTemplatePlace =
  | "item"
  | "table"
  | "list"
  | "page"
  | "error"
  | "pagingBody"
  | "pagingMember";

/** The response roles of a paging style (ADR 0002 section 14), each a slot of its templates. */
export const TREE_NODES_RESPONSE_ROLES: readonly string[] = [
  "items",
  "nextCursor",
  "previousCursor",
  "more",
  "page",
  "offset",
  "limit",
  "from",
  "to",
  "total",
  "totalPages",
  "self",
  "first",
  "previous",
  "next",
  "last",
  "nextSince",
  "complete",
];

const EVERYWHERE = ["status", "self", "path"];
const SUCCESS = [...EVERYWHERE, "payload", "meta", "resource"];
const PAGING = [...EVERYWHERE, "resource", "collection", ...TREE_NODES_RESPONSE_ROLES];

const SLOTS_BY_PLACE: Readonly<Record<TreeNodesTemplatePlace, readonly string[]>> = {
  item: [...SUCCESS, "id", "fields", "collection"],
  table: [...SUCCESS, "collection"],
  list: [...SUCCESS, "collection"],
  page: [...SUCCESS, "items"],
  error: [...EVERYWHERE, "code", "nature", "title", "detail", "instance", "traceId", "params"],
  // A style's whole page body may write `$meta`, the format's meta fields; its meta members may not.
  pagingBody: [...PAGING, "meta"],
  pagingMember: PAGING,
};

// Inside `$as`, the element of the array slot and what is read from it.
const EACH_SLOTS: readonly string[] = ["item", "itemId", "itemFields", "itemSelf"];

// What a slot holds (ADR 0002 section 13): `collection` is the only name; `payload` holds the operation's payload and
// `item` an element of it, checked against each operation. Every other slot holds a text or a number value, which
// may not name a member: it can be missing or come from data.
const SLOT_KINDS: Readonly<Record<string, TemplateSlotKind>> = {
  collection: "name",
  payload: "payload",
  item: "payload",
  meta: "object",
  params: "object",
  fields: "object",
  itemFields: "object",
  items: "array",
  more: "flag",
  complete: "flag",
};

const slotsOf = (names: readonly string[]): TemplateSlot[] =>
  names.map((name) => ({
    name,
    kind: Object.hasOwn(SLOT_KINDS, name) ? (SLOT_KINDS[name] ?? "value") : "value",
  }));

/** Where a template is read and who it belongs to, for its diagnostics. */
export interface TreeNodesTemplateSite {
  readonly context: TreeNodesContext;
  readonly place: TreeNodesTemplatePlace;
  /** The owner, as messages name it: `the format acmeEnvelope`, `the paging style cursor`. */
  readonly owner: string;
}

/** The template written at `pointer`, undefined when it is refused (each fault reported where it is written). */
export function treeNodesTemplate(
  site: TreeNodesTemplateSite,
  value: TreeNodesJson,
  pointer: string,
): IrWriter.Template | undefined {
  const { context, place, owner } = site;
  const reading: TemplateSite = {
    slots: slotsOf(SLOTS_BY_PLACE[place]),
    eachSlots: slotsOf(EACH_SLOTS),
    owner,
    placeName: PLACE_NAMES[place],
    exampleSlot: "$payload",
    adrSections: "ADR 0002 sections 13 and 14",
    report: ({ rule, pointer: at, message, fix }) =>
      context.report(
        treeNodesError({
          rule,
          origin: treeNodesNodeOrigin(treeNodesOriginAt(context, at)),
          message,
          fix,
        }),
      ),
  };

  return templateRead(reading, value, pointer);
}

export {
  templateSlots as treeNodesTemplateSlots,
  templateUses as treeNodesTemplateUses,
} from "../../../templates/index.js";

const PLACE_NAMES: Readonly<Record<TreeNodesTemplatePlace, string>> = {
  item: "success.item",
  table: "success.table",
  list: "success.list",
  page: "success.page",
  error: "an error body",
  pagingBody: "a paging style's body",
  pagingMember: "a paging style's meta, headers and links",
};
