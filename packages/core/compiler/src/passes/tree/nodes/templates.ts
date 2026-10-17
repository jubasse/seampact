import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import {
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesPointer,
} from "./raw.js";

// The template language of format shapes and paging styles (ADR 0002 sections 13 and 14): a raw template read into
// the IR's `Template`, each slot checked against the closed slot catalogue of the place it is written in.

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
  item: [...SUCCESS, "id", "fields"],
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

const MERGE_KEY = "$merge";
const EACH_KEY = "$each";
const AS_KEY = "$as";

const SLOT_NAME = "[A-Za-z][A-Za-z0-9]*";
const MEMBER_NAME = "[A-Za-z_][A-Za-z0-9_]*";
const WHOLE_SLOT = new RegExp(`^\\$(${SLOT_NAME})((?:\\.${MEMBER_NAME})*)$`);
const TEXT_SLOT = new RegExp(`^\\$\\{(${SLOT_NAME})((?:\\.${MEMBER_NAME})*)\\}`);
const NAME_SLOT = new RegExp(`^\\$(${SLOT_NAME})$`);

/** Where a template is read and who it belongs to, for its diagnostics. */
export interface TreeNodesTemplateSite {
  readonly context: TreeNodesContext;
  readonly place: TreeNodesTemplatePlace;
  /** The owner, as messages name it: `the format acmeEnvelope`, `the paging style cursor`. */
  readonly owner: string;
}

interface Reading {
  readonly site: TreeNodesTemplateSite;
  readonly inEach: boolean;
  faults: number;
}

/** A slot a template writes, with the member path read from it. */
export interface TreeNodesTemplateSlot {
  readonly slot: string;
  readonly path: readonly string[];
}

/** The template written at `pointer`, undefined when it is refused (each fault reported where it is written). */
export function treeNodesTemplate(
  site: TreeNodesTemplateSite,
  value: TreeNodesJson,
  pointer: string,
): IrWriter.Template | undefined {
  const reading: Reading = { site, inEach: false, faults: 0 };
  const template = templateOf(reading, value, pointer);

  return reading.faults === 0 ? template : undefined;
}

/** Every slot a template writes: whole slots, text parts, member names, the merged slot and each array slot. */
export function treeNodesTemplateSlots(template: IrWriter.Template): TreeNodesTemplateSlot[] {
  switch (template.kind) {
    case "slot":
      return [{ slot: template.slot, path: template.path }];
    case "text":
      return template.parts.flatMap((part) =>
        part.kind === "slot" ? [{ slot: part.slot, path: part.path }] : [],
      );
    case "literal":
      return [];
    case "object":
      return [
        ...(template.merge === undefined ? [] : [{ slot: template.merge, path: [] }]),
        ...template.members.flatMap((member) => [
          ...(member.name.kind === "slot" ? [{ slot: member.name.slot, path: [] }] : []),
          ...treeNodesTemplateSlots(member.value),
        ]),
      ];
    case "array":
      return template.items.flatMap(treeNodesTemplateSlots);
    case "each":
      return [{ slot: template.of, path: [] }, ...treeNodesTemplateSlots(template.as)];
  }
}

/** Whether a template writes `slot` anywhere. */
export const treeNodesTemplateUses = (template: IrWriter.Template, slot: string): boolean =>
  treeNodesTemplateSlots(template).some((used) => used.slot === slot);

function templateOf(
  reading: Reading,
  value: TreeNodesJson,
  pointer: string,
): IrWriter.Template | undefined {
  if (typeof value === "string") return stringTemplate(reading, value, pointer);

  if (Array.isArray(value))
    return {
      kind: "array",
      items: value.flatMap((item, index) => {
        const template = templateOf(reading, item, `${pointer}/${index}`);

        return template === undefined ? [] : [template];
      }),
    };

  if (treeNodesIsObject(value)) return objectTemplate(reading, value, pointer);

  return { kind: "literal", value: pipelineCopy(value) };
}

function stringTemplate(
  reading: Reading,
  value: string,
  pointer: string,
): IrWriter.Template | undefined {
  const whole = WHOLE_SLOT.exec(value);

  if (whole !== null) {
    const [, slot = "", path = ""] = whole;

    return checkSlot(reading, slot, pointer)
      ? { kind: "slot", slot, path: pathOf(path) }
      : undefined;
  }

  const parts = textParts(reading, value, pointer);

  if (parts === undefined) return undefined;

  if (parts.every((part) => part.kind === "text"))
    return {
      kind: "literal",
      value: parts.map((part) => (part.kind === "text" ? part.text : "")).join(""),
    };

  return { kind: "text", parts };
}

const pathOf = (path: string): string[] => (path === "" ? [] : path.slice(1).split("."));

// `$$` writes a literal `$`, `${name}` a slot's text; any other `$` is refused, since it reads like a slot.
function textParts(
  reading: Reading,
  value: string,
  pointer: string,
): IrWriter.TextPart[] | undefined {
  const parts: IrWriter.TextPart[] = [];
  let text = "";
  let rest = value;

  while (rest !== "") {
    const dollar = rest.indexOf("$");

    if (dollar === -1) {
      text += rest;
      break;
    }

    text += rest.slice(0, dollar);
    rest = rest.slice(dollar);

    if (rest.startsWith("$$")) {
      text += "$";
      rest = rest.slice(2);
      continue;
    }

    const slot = TEXT_SLOT.exec(rest);

    if (slot === null)
      return refuseSyntax(reading, pointer, `the text '${value}' writes a $ that starts no slot`);

    const [written, name = "", path = ""] = slot;

    if (!checkSlot(reading, name, pointer)) return undefined;

    if (text !== "") parts.push({ kind: "text", text });
    text = "";
    parts.push({ kind: "slot", slot: name, path: pathOf(path) });
    rest = rest.slice(written.length);
  }

  if (text !== "") parts.push({ kind: "text", text });

  return parts;
}

function objectTemplate(
  reading: Reading,
  value: Readonly<Record<string, TreeNodesJson>>,
  pointer: string,
): IrWriter.Template | undefined {
  if (Object.hasOwn(value, EACH_KEY) || Object.hasOwn(value, AS_KEY))
    return eachTemplate(reading, value, pointer);

  const members: IrWriter.ObjectTemplateMember[] = [];
  let merge: string | undefined;

  for (const [key, member] of Object.entries(value)) {
    const memberPointer = treeNodesPointer(pointer, key);

    if (key === MERGE_KEY) {
      merge = slotName(reading, member, memberPointer, MERGE_KEY);
      continue;
    }

    const name = memberName(reading, key, memberPointer);
    const template = templateOf(reading, member, memberPointer);

    if (name !== undefined && template !== undefined) members.push({ name, value: template });
  }

  return { kind: "object", members, ...(merge === undefined ? {} : { merge }) };
}

function memberName(
  reading: Reading,
  key: string,
  pointer: string,
): IrWriter.MemberName | undefined {
  if (key.startsWith("$$")) return { kind: "text", text: key.slice(1) };

  if (!key.startsWith("$")) return { kind: "text", text: key };

  const slot = NAME_SLOT.exec(key)?.[1];

  if (slot === undefined)
    return refuseSyntax(
      reading,
      pointer,
      `the member name ${key} is no slot (write $$ for a literal $)`,
    );

  return checkSlot(reading, slot, pointer) ? { kind: "slot", slot } : undefined;
}

function eachTemplate(
  reading: Reading,
  value: Readonly<Record<string, TreeNodesJson>>,
  pointer: string,
): IrWriter.Template | undefined {
  const keys = Object.keys(value);

  if (keys.length !== 2 || !Object.hasOwn(value, EACH_KEY) || !Object.hasOwn(value, AS_KEY))
    return refuseSyntax(
      reading,
      pointer,
      `an array template is { ${EACH_KEY}, ${AS_KEY} } and nothing else`,
    );

  const of = slotName(reading, value[EACH_KEY], treeNodesPointer(pointer, EACH_KEY), EACH_KEY);
  const inner: Reading = { site: reading.site, inEach: true, faults: 0 };
  const as = templateOf(inner, value[AS_KEY] ?? null, treeNodesPointer(pointer, AS_KEY));

  reading.faults += inner.faults;

  return of === undefined || as === undefined ? undefined : { kind: "each", of, as };
}

// `$merge` and `$each` take a whole slot without a member path.
function slotName(
  reading: Reading,
  value: TreeNodesJson | undefined,
  pointer: string,
  key: string,
): string | undefined {
  const slot = typeof value === "string" ? NAME_SLOT.exec(value)?.[1] : undefined;

  if (slot === undefined)
    return refuseSyntax(
      reading,
      pointer,
      `${key} takes one slot ($payload), without a member path`,
    );

  return checkSlot(reading, slot, pointer) ? slot : undefined;
}

function checkSlot(reading: Reading, slot: string, pointer: string): boolean {
  const { site } = reading;

  if (SLOTS_BY_PLACE[site.place].includes(slot) || (reading.inEach && EACH_SLOTS.includes(slot)))
    return true;

  reading.faults += 1;
  site.context.report(
    treeNodesError({
      rule: "template-slot",
      origin: treeNodesNodeOrigin(originOf(site.context, pointer)),
      message: `The template of ${site.owner} writes the slot $${slot}, which ${placeName(site.place)} does not fill.`,
      fix: `Use a slot of ${placeName(site.place)} (ADR 0002 sections 13 and 14), or write $$${slot} for the literal text.`,
    }),
  );

  return false;
}

function refuseSyntax(reading: Reading, pointer: string, why: string): undefined {
  const { site } = reading;

  reading.faults += 1;
  site.context.report(
    treeNodesError({
      rule: "template-syntax",
      origin: treeNodesNodeOrigin(originOf(site.context, pointer)),
      message: `The template of ${site.owner} is not valid: ${why}.`,
      fix: `Write $name for a slot, \${name} inside a longer text, $$ for a literal $, and { $each: $slot, $as: <template> } for an array.`,
    }),
  );

  return undefined;
}

const PLACE_NAMES: Readonly<Record<TreeNodesTemplatePlace, string>> = {
  item: "success.item",
  table: "success.table",
  list: "success.list",
  page: "success.page",
  error: "an error body",
  pagingBody: "a paging style's body",
  pagingMember: "a paging style's meta, headers and links",
};

const placeName = (place: TreeNodesTemplatePlace): string => PLACE_NAMES[place];

// A template's pointer, else the nearest pointer above it that the raw tree locates.
function originOf(context: TreeNodesContext, pointer: string): IrWriter.Origin {
  for (
    let current = pointer;
    current !== "";
    current = current.slice(0, current.lastIndexOf("/"))
  ) {
    const origin = context.origin(current);

    if (origin !== undefined) return origin;
  }

  throw new Error(`the raw tree locates nothing at or above ${pointer}`);
}
