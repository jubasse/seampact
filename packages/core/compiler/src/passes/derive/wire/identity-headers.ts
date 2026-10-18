import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddParam,
  deriveWireAddSuccessHeader,
} from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The identity headers of the route's identity (FR-28, ADR 0002 section 9, ADR 0006 section 5). Each use applies
// by its `for` (`all`, `reads` for a safe operation, `writes` otherwise) and its declaration's `in` side: a request
// parameter or a response header on every success (`identity.header`); a `deadline` request header also names
// `deadlineHeader` (`identity.deadline`). A `versionToken` use drives two headers (`identity.versionToken`): the
// response header on every success of every route of the identity, and the request header on writes only,
// whatever its `for` says, since the derivation rule is the specific one. Its `required` is the use's (default
// false). On optional access an anonymous caller has no principal (ADR 0012 "Authenticate"), so every request and
// response header of the identity is optional on the wire; the identity entry keeps the use's `required`,
// which the boundary applies to a request that carries a credential. A use's type is its own `schema`, else the
// declaration's, else a string. versionToken uses are written after every `identity.header` element, so derived
// elements keep the derivation table's order.
//
// A relay route has no access until tree.nodes copies its method; this tolerance becomes an internal error then.

const HEADER = "identity.header";

const VERSION_TOKEN = "identity.versionToken";

interface Use {
  readonly use: IrWriter.IdentityHeaderUse;
  readonly declaration: IrWriter.HeaderDecl;
}

/** Writes the identity header parameters, response headers and `deadlineHeader` of the route. */
export function deriveWireIdentityHeaders(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const access = route.operation.access;

  if (access === undefined || access.kind === "public") return;

  const safe = route.operation.safe;

  if (safe === undefined) throw new Error(`tree.nodes wrote no safe on operation '${route.id}'`);

  const uses = usesOf(access.identity, scope);
  const authenticated = access.kind === "identity";

  for (const item of uses)
    if (item.declaration.semantic !== "versionToken" && applies(item.use.for, safe))
      writeHeader(route, item, authenticated, scope);

  for (const item of uses)
    if (item.declaration.semantic === "versionToken")
      writeVersionToken(route, item, { safe, authenticated }, scope);
}

const applies = (useFor: IrWriter.HeaderUseFor, safe: boolean): boolean =>
  useFor === "all" || (useFor === "reads") === safe;

// `authenticated` is false on optional access, where a request may come without a principal.
function writeHeader(
  route: DeriveWireRoute,
  item: Use,
  authenticated: boolean,
  scope: DeriveWireScope,
): void {
  const { use, declaration } = item;
  const name = declaration.name;
  const side = declaration.in;

  if (name === undefined || side === undefined)
    throw new Error(
      `access.identity wrote header '${declaration.id}' (${declaration.semantic}) without its name or side`,
    );

  if (side === "response") {
    deriveWireAddSuccessHeader(
      route,
      derivedOf(name, item, authenticated && use.required, HEADER),
      declaration.semantic,
      scope,
    );

    return;
  }

  deriveWireAddParam(
    route,
    "header",
    derivedOf(name, item, authenticated && use.required, HEADER),
    scope,
  );

  if (declaration.semantic === "deadline") route.operation.deadlineHeader = name;
}

function writeVersionToken(
  route: DeriveWireRoute,
  item: Use,
  operation: { readonly safe: boolean; readonly authenticated: boolean },
  scope: DeriveWireScope,
): void {
  const { safe, authenticated } = operation;
  const { use, declaration } = item;
  const { response, request } = declaration;

  if (response === undefined || request === undefined)
    throw new Error(
      `access.identity wrote versionToken header '${declaration.id}' without its response or request name`,
    );

  deriveWireAddSuccessHeader(
    route,
    derivedOf(response, item, authenticated, VERSION_TOKEN),
    declaration.semantic,
    scope,
  );

  if (!safe)
    deriveWireAddParam(
      route,
      "header",
      derivedOf(request, item, authenticated && use.required, VERSION_TOKEN),
      scope,
    );
}

function derivedOf(
  name: string,
  item: Use,
  required: boolean,
  derivation: string,
): DeriveWireDerived {
  return {
    name,
    type: item.use.schema ?? item.declaration.schema ?? DERIVE_WIRE_STRING_USE,
    required,
    derivedFrom: {
      derivation,
      from: [pipelineCopy(item.use.origin), pipelineCopy(item.declaration.origin)],
    },
  };
}

function usesOf(identityId: string, scope: DeriveWireScope): Use[] {
  const { identities, headers } = scope.draft;
  const identity = Object.hasOwn(identities, identityId) ? identities[identityId] : undefined;

  if (identity === undefined)
    throw new Error(
      `access.identity wrote an access naming identity '${identityId}', which is no identity`,
    );

  return identity.headers.map((use) => {
    const declaration = Object.hasOwn(headers, use.header) ? headers[use.header] : undefined;

    if (declaration === undefined)
      throw new Error(`identity '${identityId}' uses header '${use.header}', which is no header`);

    return { use, declaration };
  });
}
