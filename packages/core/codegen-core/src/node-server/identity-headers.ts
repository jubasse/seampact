import {
  type ContractIR,
  type HeaderDecl,
  type IdentityHeaderUse,
  isKnownVariant,
  type Operation,
} from "@seampact/spec/ir";
import { below } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";

// The identity headers of an operation (grammar section 9), split by side. A request header reaches the handler,
// which owes its check (`identity.headers.handler` warning). A response header has no value a handler can write:
// a reply carries only a body, so the boundary would drop it, and it is refused by name instead.

/** The refusal code of an identity header the server would write on a response. */
export const IDENTITY_RESPONSE_HEADER_FORM = "identity.response.header";

const VERSION_TOKEN_SEMANTIC = "versionToken";
const RESPONSE_SIDE = "response";

export interface OperationIdentityHeaders {
  readonly identityId: string;
  readonly requestSideUses: number;
  readonly responseSide: readonly { readonly headerId: string; readonly name: string }[];
}

/** The identity headers of the operation, or undefined when its access names no identity with headers. */
export function operationIdentityHeaders(
  ir: ContractIR,
  operation: Operation,
): OperationIdentityHeaders | undefined {
  const access = operation.access;

  if (!isKnownVariant("Access", access) || access.kind === "public") return undefined;

  const identity = ir.identities[access.identity];

  if (identity === undefined || !isKnownVariant("Identity", identity) || !("headers" in identity))
    return undefined;

  if (identity.headers.length === 0) return undefined;

  const responseSide: { headerId: string; name: string }[] = [];
  let requestSideUses = 0;

  for (const use of identity.headers) {
    const declaration = ir.headers[use.header];

    if (declaration === undefined || !isResponseSide(declaration)) {
      requestSideUses += 1;
      continue;
    }

    const responseName = responseHeaderName(declaration, use, operation);

    if (responseName !== undefined) responseSide.push({ headerId: use.header, name: responseName });
  }

  return { identityId: access.identity, requestSideUses, responseSide };
}

/** One refusal per identity header the operation would write on its responses, at the header's declaration. */
export function identityResponseHeaderRefusals(ir: ContractIR, operation: Operation): Refusal[] {
  const headers = operationIdentityHeaders(ir, operation);

  if (headers === undefined) return [];

  return headers.responseSide.map((header) =>
    refuseNotGeneratedYet(
      IDENTITY_RESPONSE_HEADER_FORM,
      `The response header '${header.name}' of the identity '${headers.identityId}'`,
      below({ member: "", operation: operation.id }, "headers", header.headerId),
    ),
  );
}

const isResponseSide = (declaration: HeaderDecl): boolean =>
  declaration.semantic === VERSION_TOKEN_SEMANTIC || declaration.in === RESPONSE_SIDE;

// A versionToken answers on every success of the identity; another semantic only where its `for` applies. An
// unknown `for` is taken to apply, so nothing is dropped unnamed.
function responseHeaderName(
  declaration: HeaderDecl,
  use: IdentityHeaderUse,
  operation: Operation,
): string | undefined {
  if (declaration.semantic === VERSION_TOKEN_SEMANTIC) return declaration.response;

  const applies =
    (use.for !== "reads" && use.for !== "writes") || (use.for === "reads") === operation.safe;

  return applies ? declaration.name : undefined;
}
