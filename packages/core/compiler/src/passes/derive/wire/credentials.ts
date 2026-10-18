import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { DERIVE_WIRE_STRING_USE, deriveWireAddParam } from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The credential parameters of the accepted schemes (`identity.authenticate`) and the CSRF header parameter
// (`csrf.cookieWrite`), ADR 0006 section 5. A credential is a parameter only where it is a header or a query
// value: a header or query scheme by its name, bearer and basic as `Authorization`, a signature scheme by its
// header name, which access.identity requires. A cookie is no parameter: the OpenAPI mapping writes it through
// the scheme (`docs/ir/12`). A credential is required only when it is the single scheme of a non-optional
// access; with several schemes the caller presents one of them.
//
// The CSRF decision is access.identity's (`Operation.csrf`); this half writes its header parameter, required only
// on identity access when every accepted scheme is a cookie that declares CSRF. On a write that also accepts a
// bearer or another scheme, the target checks the header only on requests the cookie authenticates (ADR 0012
// "One neutral, typed hook per concern"), so a bearer client never sends it; on optional access an anonymous
// caller has no session, so no token either (ADR 0012 "Authenticate").
//
// A relay route has no access until tree.nodes copies its method; this tolerance, like the ones of the identity
// headers and the idempotency key, becomes an internal error once tree.nodes copies it.

const AUTHORIZATION = "Authorization";

const AUTHENTICATE = "identity.authenticate";

/** Writes the credential and CSRF parameters of the route's access. */
export function deriveWireCredentials(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const access = route.operation.access;

  if (access === undefined || access.kind === "public") return;

  const schemes = access.schemes.map((id) => schemeOf(id, scope));
  const required = access.kind === "identity" && schemes.length === 1;

  for (const scheme of schemes) {
    const place = credentialPlace(scheme);

    if (place === undefined) continue;

    deriveWireAddParam(
      route,
      place.in,
      {
        name: place.name,
        type: DERIVE_WIRE_STRING_USE,
        required,
        derivedFrom: {
          derivation: AUTHENTICATE,
          from: [pipelineCopy(access.origin), pipelineCopy(scheme.origin)],
        },
      },
      scope,
    );
  }

  writeCsrfParam(route, access.kind, schemes, scope);
}

function writeCsrfParam(
  route: DeriveWireRoute,
  accessKind: "identity" | "optional",
  schemes: readonly IrWriter.KnownScheme[],
  scope: DeriveWireScope,
): void {
  const csrf = route.operation.csrf;

  if (csrf === undefined || csrf.kind !== "derived") return;

  const everyCookieChecked = schemes.every(
    (scheme) => scheme.kind === "cookie" && scheme.csrf !== undefined,
  );

  deriveWireAddParam(
    route,
    "header",
    {
      name: csrf.header,
      type: DERIVE_WIRE_STRING_USE,
      required: accessKind === "identity" && everyCookieChecked,
      derivedFrom: csrf.derivedFrom,
    },
    scope,
  );
}

function credentialPlace(
  scheme: IrWriter.KnownScheme,
): { in: "header" | "query"; name: string } | undefined {
  switch (scheme.kind) {
    case "header":
      return { in: "header", name: scheme.name };
    case "query":
      return { in: "query", name: scheme.name };
    case "bearer":
    case "basic":
      return { in: "header", name: AUTHORIZATION };
    case "signature":
      if (scheme.name === undefined)
        throw new Error(
          `access.identity wrote signature scheme '${scheme.id}' without its header name`,
        );

      return { in: "header", name: scheme.name };
    case "cookie":
      return undefined;
  }
}

function schemeOf(id: string, scope: DeriveWireScope): IrWriter.KnownScheme {
  const schemes = scope.draft.schemes;
  const scheme = Object.hasOwn(schemes, id) ? schemes[id] : undefined;

  if (scheme === undefined)
    throw new Error(`access.identity wrote an access naming scheme '${id}', which is no scheme`);

  return scheme;
}
