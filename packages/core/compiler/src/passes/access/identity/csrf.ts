import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import type { AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope } from "./access.js";
import { accessIdentityIsObject, accessIdentityPointer, accessIdentityString } from "./read.js";

// The CSRF decision of an operation (ADR 0002 section 9, ADR 0006 section 5 `csrf.cookieWrite`): derived on a
// non-safe operation whose write schemes include a cookie scheme declaring `csrf` (opt-in, A34), exempt where the
// nearest `csrf: { exempt }` says so, and absent on a safe operation (a batch read included) and on a signed
// identity's route, which never derives it (ADR 0013).

const CSRF_DERIVATION = "csrf.cookieWrite";

type CookieScheme = Extract<IrWriter.KnownScheme, { kind: "cookie" }>;

/** The `csrf` member of an operation; undefined when it has none, or when refused with the error reported. */
export function accessIdentityCsrf(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): IrWriter.KnownCsrf | undefined {
  if (route.safe || resolved.identity?.kind === "signed") return undefined;

  const exempt = scope.context.inherited(route.node, "csrf")?.entry;
  if (exempt !== undefined) {
    // The authoring schema writes `csrf` as `{ exempt: <reason> }`.
    const reason = accessIdentityIsObject(exempt.value)
      ? accessIdentityString(exempt.value, "exempt")
      : undefined;
    if (reason === undefined) throw new Error(`the csrf set at ${exempt.node.pointer} has no exempt reason`);
    return { kind: "exempt", reason, origin: pipelineCopy(exempt.origin) };
  }

  const { access, identity } = resolved;
  if (access.kind === "public" || identity === undefined) return undefined;
  return derivedCsrf(route, access.schemes, identity, scope);
}

function derivedCsrf(
  route: AccessIdentityRoute,
  schemes: readonly string[],
  identity: IrWriter.KnownIdentity,
  scope: AccessIdentityScope,
): IrWriter.KnownCsrf | undefined {
  const cookies = schemes
    .map((id) => scope.built.schemes.get(id))
    .filter((scheme): scheme is CookieScheme => scheme?.kind === "cookie" && scheme.csrf !== undefined);
  if (cookies.length === 0) return undefined;

  // A csrf header scheme left out of the catalogue for an error of its own is already reported.
  const headers = cookies.map((cookie) => {
    const header = scope.built.schemes.get(cookie.csrf ?? "");
    return header?.kind === "header" ? header.name : undefined;
  });
  const names = [...new Set(headers)];
  const [name] = names;
  if (name === undefined || names.includes(undefined)) return undefined;

  if (names.length > 1) {
    scope.reporter.error({
      rule: "csrf-header",
      message: `the write schemes of identity '${identity.id}' on route '${route.id}' are cookie schemes naming different csrf headers (${names.join(", ")}), and a route checks one`,
      fix: "Name one csrf header scheme on every cookie scheme an identity accepts on writes.",
      pointer: route.node.pointer,
      related: [
        {
          pointer: accessIdentityPointer("", "identities", identity.id, "schemes", "write"),
          message: "the identity's write schemes",
        },
      ],
    });
    return undefined;
  }

  return {
    kind: "derived",
    header: name,
    derivedFrom: {
      derivation: CSRF_DERIVATION,
      from: [pipelineCopy(identity.origin), ...cookies.map((cookie) => pipelineCopy(cookie.origin))],
    },
  };
}
