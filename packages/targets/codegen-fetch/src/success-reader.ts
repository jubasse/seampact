import {
  below,
  type IrLocation,
  type Refusal,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type {
  HeaderTemplate,
  PagingStyle,
  SlotTemplate,
  Template,
  TextTemplate,
  WireFormat,
} from "@seampact/spec/ir";

// Where the client finds a success payload or a page fact: a member path in the JSON body, a response header, a
// `Link` relation, or a query parameter of a `Link` target (the cursor of the `next` page).
export type FactSource =
  | { from: "body"; path: string[] }
  | { from: "header"; header: string }
  | { from: "link"; rel: string }
  | { from: "linkParam"; rel: string; param: string };

export type FactValue = "number" | "text" | "boolean";

// One page fact, named after its response role (ADR 0002 section 14).
export interface PageFact {
  role: string;
  value: FactValue;
  required: boolean;
  source: FactSource;
}

export interface PageReader {
  items: string[];
  facts: PageFact[];
}

interface RoleReading {
  value: FactValue;
  required: boolean;
}

// The response roles and how each one is read; an optional role is absent or `null` at either end of the list.
const RESPONSE_ROLES: ReadonlyMap<string, RoleReading> = new Map([
  ["nextCursor", { value: "text", required: false }],
  ["previousCursor", { value: "text", required: false }],
  ["more", { value: "boolean", required: true }],
  ["page", { value: "number", required: true }],
  ["offset", { value: "number", required: true }],
  ["limit", { value: "number", required: true }],
  ["from", { value: "number", required: false }],
  ["to", { value: "number", required: false }],
  ["total", { value: "number", required: true }],
  ["totalPages", { value: "number", required: true }],
  ["self", { value: "text", required: true }],
  ["first", { value: "text", required: true }],
  ["previous", { value: "text", required: false }],
  ["next", { value: "text", required: false }],
  ["last", { value: "text", required: true }],
  ["nextSince", { value: "text", required: true }],
  ["complete", { value: "boolean", required: true }],
]);

// Slots the caller already knows (the status, the request path, the resource and collection names): written by
// the server, never read back.
const KNOWN_TO_CALLER_SLOTS: readonly string[] = ["status", "path", "resource", "collection"];

// Slots that rebuild a record from its parts; the client reads a payload only as a whole.
const RECORD_PART_SLOTS: readonly string[] = [
  "id",
  "fields",
  "item",
  "itemId",
  "itemFields",
  "itemSelf",
];

const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";
const META_SLOT = "meta";
const SELF_SLOT = "self";

// Cursor links: the relation's role, the cursor fact it gives, and the request roles whose parameter carries it.
const CURSOR_LINKS = [
  { linkRole: "next", cursorRole: "nextCursor", requestRoles: ["cursor", "after"] },
  { linkRole: "previous", cursorRole: "previousCursor", requestRoles: ["cursor", "before"] },
] as const;
const QUERY_PLACEMENT = "query";

type SlotVisitor = (slot: SlotTemplate, path: string[], location: IrLocation) => void;

// The member path of `$payload` in an item, table or list body (`[]` for the bare payload).
export function payloadPathOf(
  body: Template,
  location: IrLocation,
  refusals: Refusal[],
): string[] | undefined {
  const paths: string[][] = [];

  walkTemplate(body, [], location, refusals, (slot, path, slotLocation) => {
    if (slot.slot === PAYLOAD_SLOT) {
      refuseSlotMember(slot, slotLocation, refusals);
      paths.push(path);

      return;
    }

    // `$meta` holds the format's meta fields, refused with the format while it declares any; an item's `$self`
    // is its member URL, which the caller builds from the id it holds.
    if (slot.slot === META_SLOT || slot.slot === SELF_SLOT) return;

    refuseUnreadSlot(slot, slotLocation, refusals);
  });

  return onlyPath(paths, PAYLOAD_SLOT, location, refusals);
}

// The items path and the facts of a page: the style's body, or the format's page body with the style's `meta`
// members in its `$meta`, then the style's headers and links.
export function pageReaderOf(
  style: PagingStyle,
  format: WireFormat,
  refusals: Refusal[],
): PageReader | undefined {
  const styleLocation = below({ member: "" }, "pagings", style.id, "response");
  const { response } = style;
  const itemPaths: string[][] = [];
  const facts: PageFact[] = [];
  let metaPlaced = false;

  const addFact = (role: string, source: FactSource, location: IrLocation) => {
    const reading = RESPONSE_ROLES.get(role);

    if (reading === undefined) {
      refusals.push(refuseUnknownValueAt(location, role));

      return;
    }

    // A role written twice holds one value: the first place read is enough.
    if (facts.some((fact) => fact.role === role)) return;

    facts.push({ role, ...reading, source });
  };

  const visitRoles: SlotVisitor = (slot, path, location) => {
    if (slot.slot === ITEMS_SLOT) {
      refuseSlotMember(slot, location, refusals);
      itemPaths.push(path);

      return;
    }

    if (KNOWN_TO_CALLER_SLOTS.includes(slot.slot)) return;

    if (RECORD_PART_SLOTS.includes(slot.slot) || slot.slot === PAYLOAD_SLOT) {
      refuseUnreadSlot(slot, location, refusals);

      return;
    }

    if (refuseSlotMember(slot, location, refusals)) return;

    addFact(slot.slot, { from: "body", path }, location);
  };

  // In the format's page body, `$meta` is joined by the style's `meta` members.
  const visitFormatPage: SlotVisitor = (slot, path, location) => {
    if (slot.slot !== META_SLOT) {
      visitRoles(slot, path, location);

      return;
    }

    metaPlaced = true;

    response.meta.forEach((member, index) => {
      walkTemplate(
        member.value,
        [...path, member.name],
        below(styleLocation, "meta", index, "value"),
        refusals,
        visitRoles,
      );
    });
  };

  // In the style's body, `$meta` holds the format's meta fields only, refused with the format.
  const visitStyleBody: SlotVisitor = (slot, path, location) => {
    if (slot.slot !== META_SLOT) visitRoles(slot, path, location);
  };

  if (response.body === undefined) {
    const formatPageLocation = below({ member: "" }, "formats", format.id, "success", "page");

    walkTemplate(
      format.success.page.body,
      [],
      below(formatPageLocation, "body"),
      refusals,
      visitFormatPage,
    );
  } else {
    walkTemplate(response.body, [], below(styleLocation, "body"), refusals, visitStyleBody);
  }

  if (response.meta.length > 0 && !metaPlaced) {
    refusals.push(
      refuseInconsistentIr(
        "paging.response.meta.unplaced",
        "The paging style's `meta` members have no `$meta` to join",
        below(styleLocation, "meta"),
      ),
    );
  }

  response.headers.forEach((header, index) => {
    headerFact(header, below(styleLocation, "headers", index), refusals, addFact);
  });

  response.links.forEach((link, index) => {
    addFact(link.role, { from: "link", rel: link.rel }, below(styleLocation, "links", index));
  });

  addLinkCursors(style, facts, addFact, styleLocation);

  const items = onlyPath(itemPaths, ITEMS_SLOT, below(styleLocation, "body"), refusals);

  return items === undefined ? undefined : { items, facts };
}

// A header whose value is one role slot is read as that fact; a header holding no role is left to the caller
// through `headers`.
function headerFact(
  header: HeaderTemplate,
  location: IrLocation,
  refusals: Refusal[],
  addFact: (role: string, source: FactSource, location: IrLocation) => void,
): void {
  const { value } = header;
  const source: FactSource = { from: "header", header: header.name.toLowerCase() };
  const valueLocation = below(location, "value");

  if (value.kind === "slot" && "slot" in value) {
    if (!RESPONSE_ROLES.has(value.slot)) return;

    if (!refuseSlotMember(value, valueLocation, refusals)) addFact(value.slot, source, location);

    return;
  }

  if (value.kind !== "text" || !("parts" in value)) return;

  const roleParts = value.parts.filter(
    (part) => part.kind === "slot" && "slot" in part && RESPONSE_ROLES.has(part.slot),
  );

  if (roleParts.length === 0) return;

  const [onlyPart] = value.parts;

  if (value.parts.length === 1 && onlyPart !== undefined && "slot" in onlyPart) {
    if (onlyPart.path.length === 0) {
      addFact(onlyPart.slot, source, location);

      return;
    }
  }

  refusals.push(
    refuseNotGeneratedYet(
      "paging.response.headers.text",
      `The header '${header.name}', with text around its role,`,
      valueLocation,
    ),
  );
}

// A cursor style's `next` and `previous` links carry the cursors in their query, unless a template writes them.
function addLinkCursors(
  style: PagingStyle,
  facts: readonly PageFact[],
  addFact: (role: string, source: FactSource, location: IrLocation) => void,
  location: IrLocation,
): void {
  for (const { linkRole, cursorRole, requestRoles } of CURSOR_LINKS) {
    if (facts.some((fact) => fact.role === cursorRole)) continue;

    const link = style.response.links.find((each) => each.role === linkRole);
    const cursorParam = style.request.find(
      (role) => requestRoles.some((each) => each === role.role) && role.in === QUERY_PLACEMENT,
    );

    if (link === undefined || cursorParam === undefined) continue;

    addFact(
      cursorRole,
      { from: "linkParam", rel: link.rel, param: cursorParam.name },
      below(location, "links"),
    );
  }
}

function walkTemplate(
  template: Template,
  path: string[],
  location: IrLocation,
  refusals: Refusal[],
  visitSlot: SlotVisitor,
): void {
  if (template.kind === "slot" && "slot" in template) {
    visitSlot(template, path, location);

    return;
  }

  if (template.kind === "literal") return;

  if (template.kind === "text" && "parts" in template) {
    refuseReadSlotInText(template.parts, location, refusals);

    return;
  }

  if (template.kind === "object" && "members" in template) {
    if (template.merge !== undefined) {
      refusals.push(
        refuseNotGeneratedYet("format.template", "A `$merge` in a success body", location),
      );
    }

    template.members.forEach((member, index) => {
      const memberLocation = below(location, "members", index);

      if (member.name.kind !== "text" || !("text" in member.name)) {
        refusals.push(
          refuseNotGeneratedYet(
            "format.template",
            "A member name slot in a success body",
            below(memberLocation, "name"),
          ),
        );

        return;
      }

      walkTemplate(
        member.value,
        [...path, member.name.text],
        below(memberLocation, "value"),
        refusals,
        visitSlot,
      );
    });

    return;
  }

  if (template.kind === "array" || template.kind === "each") {
    refusals.push(
      refuseNotGeneratedYet(
        "format.template",
        `An '${template.kind}' template in a success body`,
        location,
      ),
    );

    return;
  }

  refusals.push(refuseUnknownValueAt(below(location, "kind"), template.kind));
}

// A text template is a constant or request-derived string; one that holds a value the client reads is refused.
function refuseReadSlotInText(
  parts: TextTemplate["parts"],
  location: IrLocation,
  refusals: Refusal[],
): void {
  const readsSlot = parts.some(
    (part) =>
      part.kind === "slot" &&
      "slot" in part &&
      (RESPONSE_ROLES.has(part.slot) || part.slot === PAYLOAD_SLOT || part.slot === ITEMS_SLOT),
  );

  if (!readsSlot) return;

  refusals.push(
    refuseNotGeneratedYet(
      "format.template",
      "A text template holding a payload or a page role",
      location,
    ),
  );
}

function refuseSlotMember(slot: SlotTemplate, location: IrLocation, refusals: Refusal[]): boolean {
  if (slot.path.length === 0) return false;

  refusals.push(
    refuseNotGeneratedYet(
      "format.template",
      `A member of the slot \`$${slot.slot}\` in a success body`,
      location,
    ),
  );

  return true;
}

function refuseUnreadSlot(slot: SlotTemplate, location: IrLocation, refusals: Refusal[]): void {
  if (KNOWN_TO_CALLER_SLOTS.includes(slot.slot)) return;

  refusals.push(
    RECORD_PART_SLOTS.includes(slot.slot) || slot.slot === PAYLOAD_SLOT
      ? refuseNotGeneratedYet(
          "format.template",
          `The slot \`$${slot.slot}\` in a success body`,
          location,
        )
      : refuseUnknownValueAt(location, slot.slot),
  );
}

function onlyPath(
  paths: readonly string[][],
  slot: string,
  location: IrLocation,
  refusals: Refusal[],
): string[] | undefined {
  const [path] = paths;

  if (paths.length === 1 && path !== undefined) return [...path];

  refusals.push(
    refuseInconsistentIr(
      `success.${slot}.count`,
      `A success body writes \`$${slot}\` ${paths.length} times instead of once`,
      location,
    ),
  );

  return undefined;
}
