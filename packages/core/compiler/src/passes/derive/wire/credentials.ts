import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { DERIVE_WIRE_STRING_USE, deriveWireAddParam } from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The credential parameters of the accepted schemes (`identity.authenticate`) and the CSRF header parameter
// (`csrf.cookieWrite`), ADR 0006 section 5. A credential is a parameter only where it is a header or a query
// value: a header or query scheme by its name, bearer and basic as `Authorization`, a signature scheme by its
// header name. A cookie is no parameter: the OpenAPI mapping writes it through the scheme (`docs/ir/12`). A
// credential is required only when it is the single scheme of a non-optional access; with several schemes the
// caller presents one of them. The CSRF decision is access.identity's (`Operation.csrf`); this half writes its
// header parameter, required only when every accepted scheme is a cookie that declares CSRF: on a write that also
// accepts a bearer or another scheme, the target checks the header only on requests the cookie authenticates
// (ADR 0012 "One neutral, typed hook per concern"), so a bearer client never sends it.

const AUTHORIZATION = "Authorization";

const AUTHENTICATE = "identity.authenticate";

/** Writes the credential and CSRF parameters of the route's access. */
export function deriveWireCredentials(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const access = route.operation.access;

  // A relay route has no access until tree.nodes copies its method (access.identity leaves it out then).
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

  writeCsrfParam(route, schemes, scope);
}

function writeCsrfParam(
  route: DeriveWireRoute,
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
      required: everyCookieChecked,
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
      return scheme.name === undefined ? undefined : { in: "header", name: scheme.name };
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
