import {
  below,
  type IrLocation,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
  requireName,
} from "@seampact/codegen-core";
import type { ContractIR, Operation, Response } from "@seampact/spec/ir";
import { REFUSED_TYPE, type TypeContext, typeExpression } from "./type-expression.js";

const JSON_MEDIA = "application/json";

// The 304 that `cache.etag` derives is answered by the boundary, never by the handler.
export const ETAG_DERIVATION = "cache.etag";
const NOT_GENERATED_SHAPES: readonly string[] = ["binary", "redirect"];

// The members a handler returns beside a page's items, by paging style `handlerResult` value (ADR 0002
// section 14): a cursor is absent at its end of the list, every other member is always returned.
const HANDLER_RESULT_MEMBERS: ReadonlyMap<string, string> = new Map([
  ["nextCursor", "nextCursor?: string;"],
  ["previousCursor", "previousCursor?: string;"],
  ["total", "total: number;"],
  ["more", "more: boolean;"],
  ["nextSince", "nextSince: string;"],
  ["complete", "complete: boolean;"],
]);

// The handler-side union of the operation's responses, `{ status, body }` with the unwrapped payload; the
// boundary adds the envelope and the derived headers, and answers the derived 304.
export function operationOutputDeclaration(
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const variants = operation.responses.flatMap((response, index) => {
    if (response.derivedFrom?.derivation === ETAG_DERIVATION) return [];

    return [responseVariant(response, operation, below(location, "responses", index), context)];
  });
  const typeName = requireName(context.layout.operationTypeNames, operation.id).output;
  const union = variants.length === 0 ? "never" : variants.join(" | ");

  return `/** The union of the operation's success responses, as its handler returns them. */\nexport type ${typeName} = ${union};`;
}

function responseVariant(
  response: Response,
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const status = `status: ${response.status};`;

  refuseHandlerHeaders(response, location, context);

  switch (response.shape) {
    case "empty":
      return `{ ${status} }`;
    case "item":
      return payloadVariant(response, "item", operation, location, context);
    case "table":
      return payloadVariant(response, "table", operation, location, context);
    case "page":
      return payloadVariant(response, "page", operation, location, context);
    case "list":
      return payloadVariant(response, "list", operation, location, context);
    default:
      context.refusals.push(
        NOT_GENERATED_SHAPES.includes(response.shape)
          ? refuseNotGeneratedYet(
              "response.shape",
              `A '${response.shape}' response`,
              below(location, "shape"),
            )
          : refuseUnknownValueAt(below(location, "shape"), response.shape),
      );

      return REFUSED_TYPE;
  }
}

// A header the route writes itself has no `derivedFrom`; the handler result has no member for it yet.
function refuseHandlerHeaders(
  response: Response,
  location: IrLocation,
  context: TypeContext,
): void {
  response.headers.forEach((header, index) => {
    if (header.derivedFrom !== undefined) return;

    context.refusals.push(
      refuseNotGeneratedYet(
        "response.header",
        `The response header '${header.name}', written by the route,`,
        below(location, "headers", index),
      ),
    );
  });
}

function payloadVariant(
  response: Response,
  shape: "item" | "table" | "list" | "page",
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const status = `status: ${response.status};`;

  if (response.media !== JSON_MEDIA) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "response.media",
        `A '${response.media ?? "missing"}' response body`,
        below(location, "media"),
      ),
    );
  }

  if (response.body === undefined) {
    context.refusals.push(
      refuseInconsistentIr("response.body.missing", `A '${shape}' response has no body`, location),
    );

    return REFUSED_TYPE;
  }

  const payload = typeExpression(response.body, below(location, "body"), context);

  switch (shape) {
    case "item":
      return `{ ${status} body: ${payload}; }`;
    case "table":
      return `{ ${status} body: Record<string, ${payload}>; }`;
    case "list":
      return `{ ${status} body: ${payload}[]; }`;
    case "page":
      return `{ ${status} body: ${pageResult(payload, operation, location, context)}; }`;
  }
}

// The page a handler returns: its items, and the members its paging style's `handlerResult` lists.
function pageResult(
  itemType: string,
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const style = pagingStyleOf(operation, context.ir);

  if (style === undefined) {
    context.refusals.push(
      refuseInconsistentIr(
        "response.page.style.missing",
        "A page response has no paging style",
        location,
      ),
    );

    return REFUSED_TYPE;
  }

  const members = style.handlerResult.map((member, index) => {
    const memberLocation = below({ member: "" }, "pagings", style.id, "handlerResult", index);
    const declaration = HANDLER_RESULT_MEMBERS.get(member);

    if (declaration !== undefined) return declaration;

    context.refusals.push(refuseUnknownValueAt(memberLocation, member));

    return "";
  });

  return `{\nitems: ${itemType}[];\n${members.join("\n")}\n}`;
}

export function pagingStyleOf(operation: Operation, ir: ContractIR) {
  const styleId = operation.paging?.style;

  if (styleId === undefined || !Object.hasOwn(ir.pagings, styleId)) return undefined;

  return ir.pagings[styleId];
}
