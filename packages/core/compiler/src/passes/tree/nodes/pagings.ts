import type { IrWriter, Origin } from "@seampact/spec/ir";
import type { RelatedLocation } from "../../../diagnostics/diagnostic.js";
import { type DraftIR, pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesAbsent, treeNodesNamedTemplates } from "./formats.js";
import {
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesOriginAt,
  treeNodesPointer,
} from "./raw.js";
import { TREE_NODES_PAGING_NONE } from "./responses.js";
import {
  TREE_NODES_RESPONSE_ROLES,
  type TreeNodesTemplateSite,
  treeNodesTemplate,
  treeNodesTemplateSlots,
  treeNodesTemplateUses,
} from "./templates.js";

// The paging styles the lists use (ADR 0002 section 14, ADR 0004 section 8): each read from `pagings` with its
// position kind, request roles, response templates and the handler result its roles ask for. Each style is then
// checked against the format of every list using it.

const POSITION_ROLES: readonly IrWriter.PagingPosition[] = ["cursor", "page", "offset", "since"];
const REQUEST_ROLES: readonly IrWriter.PagingRole[] = [
  "cursor",
  "after",
  "before",
  "page",
  "offset",
  "since",
  "limit",
  "sort",
];
const PLACEMENTS: readonly IrWriter.PagingParamPlacement[] = ["query", "header"];
const SORT_STYLES: readonly IrWriter.PagingParamStyle[] = ["signed", "pair", "keyed", "split"];
const URL_ROLES: readonly IrWriter.UrlRole[] = ["self", "first", "previous", "next", "last"];
const HANDLER_RESULT: readonly IrWriter.HandlerResultMember[] = [
  "nextCursor",
  "previousCursor",
  "total",
  "more",
  "nextSince",
  "complete",
];

// `page` counts from 1 unless `base` says 0.
const DEFAULT_PAGE_BASE = 1;
const SPLIT_STYLE: IrWriter.PagingParamStyle = "split";
const KEYED_STYLE: IrWriter.PagingParamStyle = "keyed";
const KEY_PLACEHOLDER = "{key}";

// The kinds each response role belongs to; a role left out belongs to every kind.
const ROLE_KINDS: Readonly<Record<string, readonly IrWriter.PagingPosition[]>> = {
  nextCursor: ["cursor"],
  previousCursor: ["cursor"],
  page: ["page", "offset"],
  offset: ["page", "offset"],
  from: ["page", "offset"],
  to: ["page", "offset"],
  total: ["cursor", "page", "offset"],
  totalPages: ["page", "offset"],
  last: ["page", "offset"],
  nextSince: ["since"],
  complete: ["since"],
};

// The roles that make the handler return the total.
const TOTAL_ROLES: readonly string[] = ["total", "totalPages", "last"];

// The URL roles a cursor or since kind builds from a value the handler returns.
const URL_ROLE_RESULTS: Readonly<
  Record<IrWriter.PagingPosition, Readonly<Record<string, IrWriter.HandlerResultMember>>>
> = {
  cursor: { next: "nextCursor", previous: "previousCursor" },
  since: { next: "nextSince" },
  page: {},
  offset: {},
};

/** Writes `pagings`: every style a list operation pages with. */
export function treeNodesPagings(draft: DraftIR, context: TreeNodesContext): void {
  refuseReservedStyle(context);

  const used = new Set(draft.operations.flatMap((operation) => operation.paging?.style ?? []));

  for (const id of used) {
    const style = styleOf(context, id);

    if (style !== undefined) draft.pagings[id] = style;
  }

  checkFormats(draft, context);
}

// ADR 0002 section 13: `none` names an unpaged list, never a style.
function refuseReservedStyle(context: TreeNodesContext): void {
  const origin = context.origin(treeNodesPointer("/pagings", TREE_NODES_PAGING_NONE));

  if (origin === undefined) return;

  context.report(
    treeNodesError({
      rule: "paging-reserved",
      origin: treeNodesNodeOrigin(origin),
      message: `The paging style name ${TREE_NODES_PAGING_NONE} is reserved for a list served whole.`,
      fix: `Rename the style ${TREE_NODES_PAGING_NONE}.`,
    }),
  );
}

/** Reads a declared style; undefined when it is refused (reported) or declared nowhere (`paging-unknown`). */
function styleOf(context: TreeNodesContext, id: string): IrWriter.PagingStyle | undefined {
  const pointer = treeNodesPointer("/pagings", id);
  const declared = treeNodesMember(context.raw.merged.pagings, id);
  const origin = context.origin(pointer);

  if (declared === undefined || origin === undefined) return undefined;

  const reader = new StyleReader(context, id, pointer);
  const request = reader.request(treeNodesMember(declared, "request"));
  const position = request === undefined ? undefined : reader.position(request);
  const response = reader.response(treeNodesMember(declared, "response"));

  if (request === undefined || position === undefined || response === undefined) return undefined;

  const used = usedRoles(response);

  if (!reader.checkKinds(position, used)) return undefined;

  return {
    id,
    origin: pipelineCopy(origin),
    position,
    absent: treeNodesAbsent(treeNodesMember(declared, "absent")),
    request,
    response,
    handlerResult: handlerResultOf(position, used),
  };
}

// The response roles a style's templates and links write.
function usedRoles(response: IrWriter.PagingResponse): Set<string> {
  const templates = [
    ...(response.body === undefined ? [] : [response.body]),
    ...response.meta.map((member) => member.value),
    ...response.headers.map((header) => header.value),
  ];
  const slots = templates.flatMap(treeNodesTemplateSlots).map(({ slot }) => slot);

  return new Set([...slots, ...response.links.map((link) => link.role)]);
}

// ADR 0002 section 14: the members the roles use, `total` for a role computed from it, `more` for a page or offset
// style that needs no total, and the value a cursor or since kind builds its next and previous URLs from.
function handlerResultOf(
  position: IrWriter.PagingPosition,
  used: ReadonlySet<string>,
): IrWriter.HandlerResultMember[] {
  const members = new Set<string>(used);
  const needsTotal = TOTAL_ROLES.some((role) => used.has(role));

  if (needsTotal) members.add("total");

  if (!needsTotal && (position === "page" || position === "offset")) members.add("more");

  for (const [role, member] of Object.entries(URL_ROLE_RESULTS[position]))
    if (used.has(role)) members.add(member);

  return HANDLER_RESULT.filter((member) => members.has(member));
}

class StyleReader {
  readonly owner: string;

  constructor(
    readonly context: TreeNodesContext,
    readonly id: string,
    readonly pointer: string,
  ) {
    this.owner = `the paging style ${id}`;
  }

  request(written: TreeNodesJson | undefined): IrWriter.PagingRequestRole[] | undefined {
    if (!treeNodesIsObject(written)) return [];

    const roles: IrWriter.PagingRequestRole[] = [];
    let refused = false;

    for (const [name, place] of Object.entries(written)) {
      const role = this.requestRole(name, place);

      if (role === undefined) refused = true;
      else roles.push(role);
    }

    return refused ? undefined : roles;
  }

  requestRole(name: string, place: TreeNodesJson): IrWriter.PagingRequestRole | undefined {
    const pointer = treeNodesPointer(this.pointer, "request", name);
    const role = REQUEST_ROLES.find((candidate) => candidate === name);

    if (role === undefined)
      throw new Error(`the paging role at ${pointer} is none of ${REQUEST_ROLES.join(", ")}`);

    const placement = PLACEMENTS.find(
      (candidate) => typeof treeNodesMember(place, candidate) === "string",
    );
    const parameter = placement === undefined ? undefined : treeNodesMember(place, placement);

    if (placement === undefined || typeof parameter !== "string")
      return this.refuseRequest(
        pointer,
        `its ${role} role names no query parameter or header`,
        "Write query or header on the role.",
      );

    const base = treeNodesMember(place, "base");
    const style = SORT_STYLES.find((candidate) => candidate === treeNodesMember(place, "style"));
    const direction = treeNodesMember(place, "direction");

    if (role === "sort" && !this.checkSort(pointer, parameter, style, direction)) return undefined;

    return {
      role,
      in: placement,
      name: parameter,
      ...(role === "page" ? { base: typeof base === "number" ? base : DEFAULT_PAGE_BASE } : {}),
      ...(style === undefined ? {} : { style }),
      ...(typeof direction === "string" ? { direction } : {}),
    };
  }

  // `split` names its direction parameter, and only it does; `keyed` holds `{key}` in its name.
  checkSort(
    pointer: string,
    parameter: string,
    style: IrWriter.PagingParamStyle | undefined,
    direction: TreeNodesJson | undefined,
  ): boolean {
    const fault = sortFault(parameter, style, direction);

    if (fault === undefined) return true;

    this.refuseRequest(pointer, fault.why, fault.fix);

    return false;
  }

  refuseRequest(pointer: string, why: string, fix: string): undefined {
    this.report(
      "paging-request",
      pointer,
      `The paging style ${this.id} is not valid: ${why}.`,
      fix,
    );

    return undefined;
  }

  // Exactly one position role, or the pair `after` and `before`, which is a cursor kind.
  position(request: readonly IrWriter.PagingRequestRole[]): IrWriter.PagingPosition | undefined {
    const roles = request.map(({ role }) => role);
    const pair = roles.includes("after") || roles.includes("before");
    const positions = POSITION_ROLES.filter((role) => roles.includes(role));

    if (pair && roles.includes("after") && roles.includes("before") && positions.length === 0)
      return "cursor";

    if (!pair && positions.length === 1) return positions[0];

    this.report(
      "paging-position",
      this.writtenOrStyle(treeNodesPointer(this.pointer, "request")),
      `The paging style ${this.id} writes no single position role.`,
      "Write exactly one of cursor, page, offset and since, or the pair after and before.",
    );

    return undefined;
  }

  response(written: TreeNodesJson | undefined): IrWriter.PagingResponse | undefined {
    const pointer = treeNodesPointer(this.pointer, "response");
    const writtenBody = treeNodesMember(written, "body");
    const body =
      writtenBody === undefined
        ? undefined
        : treeNodesTemplate(this.site("pagingBody"), writtenBody, `${pointer}/body`);
    const meta = this.meta(treeNodesMember(written, "meta"), `${pointer}/meta`);
    const headers = treeNodesNamedTemplates(
      this.context,
      this.owner,
      "pagingMember",
      treeNodesMember(written, "headers"),
      `${pointer}/headers`,
    );
    const links = this.links(treeNodesMember(written, "links"), `${pointer}/links`);

    if (
      (writtenBody !== undefined && body === undefined) ||
      meta === undefined ||
      headers === undefined
    )
      return undefined;

    if (
      links === undefined ||
      (body !== undefined && !this.checkItemsOnce(body, `${pointer}/body`))
    )
      return undefined;

    return { ...(body === undefined ? {} : { body }), meta, headers, links };
  }

  meta(written: TreeNodesJson | undefined, pointer: string): IrWriter.NamedTemplate[] | undefined {
    const templates = treeNodesNamedTemplates(
      this.context,
      this.owner,
      "pagingMember",
      written,
      pointer,
    );

    return templates?.map(({ name, value }) => ({ name, value }));
  }

  // Each link is one URL role, written as its slot (`next: $next`).
  links(written: TreeNodesJson | undefined, pointer: string): IrWriter.PagingLink[] | undefined {
    if (!treeNodesIsObject(written)) return [];

    const links: IrWriter.PagingLink[] = [];
    let refused = false;

    for (const [rel, value] of Object.entries(written)) {
      const role = URL_ROLES.find((candidate) => value === `$${candidate}`);

      if (role !== undefined) {
        links.push({ rel, role });
        continue;
      }

      refused = true;
      this.report(
        "paging-link",
        treeNodesPointer(pointer, rel),
        `The link ${rel} of the paging style ${this.id} is no URL role.`,
        `Write one of ${URL_ROLES.map((candidate) => `$${candidate}`).join(", ")}.`,
      );
    }

    return refused ? undefined : links;
  }

  checkItemsOnce(body: IrWriter.Template, pointer: string): boolean {
    const count = treeNodesTemplateSlots(body).filter(({ slot }) => slot === "items").length;

    if (count === 1) return true;

    this.report(
      "paging-items",
      pointer,
      `The page body of the paging style ${this.id} writes $items ${count === 0 ? "nowhere" : `${count} times`}.`,
      "Write $items exactly once in response.body.",
    );

    return false;
  }

  // ADR 0002 section 14: a role used outside its kinds is a compile error naming the style.
  checkKinds(position: IrWriter.PagingPosition, used: ReadonlySet<string>): boolean {
    const outside = TREE_NODES_RESPONSE_ROLES.filter(
      (role) =>
        used.has(role) && Object.hasOwn(ROLE_KINDS, role) && !ROLE_KINDS[role]?.includes(position),
    );

    for (const role of outside)
      this.report(
        "paging-role",
        treeNodesPointer(this.pointer, "response"),
        `The paging style ${this.id} pages by ${position}, but writes the role $${role}, which only ${ROLE_KINDS[role]?.join(", ")} styles fill.`,
        `Remove $${role}, or page by ${ROLE_KINDS[role]?.join(" or ")}.`,
      );

    return outside.length === 0;
  }

  // A member the style leaves out is located at the style.
  writtenOrStyle(pointer: string): string {
    return this.context.origin(pointer) === undefined ? this.pointer : pointer;
  }

  site(place: TreeNodesTemplateSite["place"]): TreeNodesTemplateSite {
    return { context: this.context, place, owner: this.owner };
  }

  report(
    rule: "paging-request" | "paging-position" | "paging-items" | "paging-role" | "paging-link",
    pointer: string,
    message: string,
    fix: string,
  ): void {
    this.context.report(
      treeNodesError({
        rule,
        origin: treeNodesNodeOrigin(treeNodesOriginAt(this.context, pointer)),
        message,
        fix,
      }),
    );
  }
}

interface SortFault {
  readonly why: string;
  readonly fix: string;
}

function sortFault(
  parameter: string,
  style: IrWriter.PagingParamStyle | undefined,
  direction: TreeNodesJson | undefined,
): SortFault | undefined {
  if (style === SPLIT_STYLE && typeof direction !== "string")
    return {
      why: "its split sort names no direction parameter",
      fix: "Write direction on the sort role.",
    };

  if (style !== SPLIT_STYLE && direction !== undefined)
    return {
      why: "its sort names a direction parameter, which only style: split reads",
      fix: "Remove direction, or write style: split.",
    };

  if (style === KEYED_STYLE && !parameter.includes(KEY_PLACEHOLDER))
    return {
      why: `its keyed sort parameter ${parameter} holds no ${KEY_PLACEHOLDER}`,
      fix: `Write ${KEY_PLACEHOLDER} in the parameter name, as order[${KEY_PLACEHOLDER}].`,
    };

  return undefined;
}

// ADR 0002 section 14: a style adding `meta` needs a format page that writes `$meta`, and the style and the format
// name no meta member twice. Each pair of a style and a format is checked once.
function checkFormats(draft: DraftIR, context: TreeNodesContext): void {
  const checked = new Set<string>();

  for (const operation of draft.operations) {
    const styleId = operation.paging?.style;
    const formatId = operation.format;

    if (styleId === undefined || formatId === undefined) continue;

    const style = Object.hasOwn(draft.pagings, styleId) ? draft.pagings[styleId] : undefined;
    const format = Object.hasOwn(draft.formats, formatId) ? draft.formats[formatId] : undefined;
    const pair = JSON.stringify([styleId, formatId]);

    if (style === undefined || format === undefined || checked.has(pair)) continue;
    checked.add(pair);

    if (style.response.body === undefined && style.response.meta.length > 0)
      checkMeta(context, style, format);
  }
}

function checkMeta(
  context: TreeNodesContext,
  style: IrWriter.PagingStyle,
  format: IrWriter.WireFormat,
): void {
  const metaPointer = treeNodesPointer("/pagings", style.id, "response", "meta");
  const related = formatRelated(format, format.origin, `the format ${format.id}`);

  if (!treeNodesTemplateUses(format.success.page.body, "meta")) {
    context.report(
      treeNodesError({
        rule: "paging-meta",
        origin: treeNodesNodeOrigin(treeNodesOriginAt(context, metaPointer)),
        message: `The paging style ${style.id} adds meta members, but the page of the format ${format.id} writes no $meta.`,
        fix: `Write response.body on ${style.id}, or use a format whose page writes $meta.`,
        related,
      }),
    );

    return;
  }

  for (const member of style.response.meta) {
    if (!Object.hasOwn(format.meta, member.name)) continue;

    const formatMember = context.origin(
      treeNodesPointer("/formats", format.id, "meta", member.name),
    );

    context.report(
      treeNodesError({
        rule: "paging-meta",
        origin: treeNodesNodeOrigin(
          treeNodesOriginAt(context, treeNodesPointer(metaPointer, member.name)),
        ),
        message: `The meta member ${member.name} is named by both the paging style ${style.id} and the format ${format.id}.`,
        fix: `Rename ${member.name} in the style's meta or in the format's meta.`,
        related: formatRelated(
          format,
          formatMember,
          `the meta field ${member.name} of ${format.id}`,
        ),
      }),
    );
  }
}

function formatRelated(
  format: IrWriter.WireFormat,
  origin: Origin | undefined,
  message: string,
): RelatedLocation[] {
  if (origin === undefined || format.origin.layer === "core") return [];

  return [{ origin: treeNodesNodeOrigin(origin), message }];
}
