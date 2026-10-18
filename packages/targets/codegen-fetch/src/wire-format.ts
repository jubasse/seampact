import {
  below,
  type IrLocation,
  type Refusal,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type { PagingStyle, Template, WireFormat } from "@seampact/spec/ir";

const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";
const CODE_SLOT = "code";
const PARAMS_MERGE = "params";
const PROBLEM_MEDIA: readonly string[] = ["application/problem+json", "application/json"];
const CURSOR_POSITION = "cursor";
const CURSOR_ROLE = "cursor";
const NEXT_URL_ROLE = "next";
const QUERY_PLACEMENT = "query";
const KNOWN_POSITIONS: readonly string[] = ["cursor", "page", "offset", "since"];

// A wire format the client reads: success bodies are the bare payload (items for a page), no success or error
// header, no `$meta`, and errors are a JSON object carrying the code with the code's params merged in.
export function refuseFormatForms(format: WireFormat): Refusal[] {
  const location = below({ member: "" }, "formats", format.id);
  const refusals: Refusal[] = [];

  for (const shape of ["item", "table"] as const) {
    refuseEnvelope(
      format.success[shape].body,
      PAYLOAD_SLOT,
      below(location, "success", shape),
      refusals,
    );
  }

  refuseEnvelope(
    format.success.page.body,
    ITEMS_SLOT,
    below(location, "success", "page"),
    refusals,
  );

  for (const shape of ["item", "table", "page"] as const) {
    if (format.success[shape].headers.length > 0) {
      refusals.push(
        refuseNotGeneratedYet(
          "format.success.headers",
          "A success header written by the format",
          below(location, "success", shape, "headers"),
        ),
      );
    }
  }

  if (Object.keys(format.meta).length > 0) {
    refusals.push(
      refuseNotGeneratedYet("format.meta", "A format `$meta`", below(location, "meta")),
    );
  }

  refuseErrorShape(format, below(location, "error"), refusals);

  return refusals;
}

function refuseEnvelope(
  body: Template,
  slot: string,
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (isWholeSlot(body, slot)) return;

  refusals.push(
    refuseNotGeneratedYet(
      "format.success.envelope",
      "A success body that wraps the payload",
      below(location, "body"),
    ),
  );
}

function refuseErrorShape(format: WireFormat, location: IrLocation, refusals: Refusal[]): void {
  const { error } = format;

  if (!PROBLEM_MEDIA.includes(error.media)) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.media",
        `A '${error.media}' error body`,
        below(location, "media"),
      ),
    );
  }

  if (error.headers.length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.headers",
        "An error header written by the format",
        below(location, "headers"),
      ),
    );
  }

  if (!carriesCodeWithMergedParams(error.body)) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.body",
        "An error body without a top-level `code` member and merged params",
        below(location, "body"),
      ),
    );
  }
}

function isWholeSlot(template: Template, slot: string): boolean {
  return (
    template.kind === "slot" &&
    "slot" in template &&
    template.slot === slot &&
    template.path.length === 0
  );
}

function carriesCodeWithMergedParams(body: Template): boolean {
  if (body.kind !== "object" || !("members" in body)) return false;

  const hasCode = body.members.some(
    (member) =>
      member.name.kind === "text" &&
      "text" in member.name &&
      member.name.text === CODE_SLOT &&
      isWholeSlot(member.value, CODE_SLOT),
  );

  return hasCode && body.merge === PARAMS_MERGE;
}

// The name of the query param that carries the cursor, or the refusals of a paging style the client cannot read:
// it reads the next cursor from the `Link` URL with relation `next`.
export function cursorParamOf(
  style: PagingStyle,
): { cursorParam: string } | { refusals: Refusal[] } {
  const location = below({ member: "" }, "pagings", style.id);
  const refusals: Refusal[] = [];

  if (style.position !== CURSOR_POSITION) {
    refusals.push(
      KNOWN_POSITIONS.includes(style.position)
        ? refuseNotGeneratedYet(
            "paging.position",
            `A '${style.position}' paging style`,
            below(location, "position"),
          )
        : refuseUnknownValueAt(below(location, "position"), style.position),
    );
  }

  const cursor = style.request.find((role) => role.role === CURSOR_ROLE);

  if (cursor === undefined || cursor.in !== QUERY_PLACEMENT) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.cursor.placement",
        "A cursor not read from the query",
        below(location, "request"),
      ),
    );
  }

  if (!style.response.links.some((link) => link.role === NEXT_URL_ROLE)) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.links.next",
        "A cursor page without a `next` link",
        below(location, "response", "links"),
      ),
    );
  }

  refusePageResponseForms(style, below(location, "response"), refusals);

  if (refusals.length > 0 || cursor === undefined) return { refusals };

  return { cursorParam: cursor.name };
}

function refusePageResponseForms(
  style: PagingStyle,
  location: IrLocation,
  refusals: Refusal[],
): void {
  const { response } = style;

  if (response.body !== undefined && !isWholeSlot(response.body, ITEMS_SLOT)) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.response.body",
        "A page body beside its items",
        below(location, "body"),
      ),
    );
  }

  if (response.meta.length > 0) {
    refusals.push(
      refuseNotGeneratedYet("paging.response.meta", "A page `meta`", below(location, "meta")),
    );
  }

  if (response.headers.length > 0) {
    refusals.push(
      refuseNotGeneratedYet("paging.response.headers", "A page header", below(location, "headers")),
    );
  }
}
