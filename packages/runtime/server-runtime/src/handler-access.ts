// What a handler reads of its caller beside its input (ADR 0012 "Open tenancy"): the principal and the resolved
// scopes of the request the boundary checked, read-only and outside the wire input.
import type { ResolvedScope } from "@seampact/hooks";
import type { AccessGrant } from "./access-checks.js";
import { unexpectedError } from "./contract-error.js";
import type { ContractRoute } from "./contract-route.js";
import { isPlainObject } from "./plain-object.js";

/**
 * The caller of an operation: its principal unless the route is public, and each scope it runs in, by scope name,
 * unless it runs in none. A principal object is a frozen shallow copy of what the authenticate hook returned.
 */
export interface HandlerAccess {
  readonly principal?: unknown;
  readonly scopes?: Readonly<Record<string, ResolvedScope>>;
}

/** The members a public route, or one in no scope, leaves out, as the generated handler input types do. */
export function handlerAccess(route: ContractRoute, grant: AccessGrant): HandlerAccess {
  const scopes = route.scopes.map((declared, index) => {
    const resolved = grant.scopes[index];

    if (resolved === undefined) {
      throw unexpectedError(
        route,
        new Error(`seampact: the scope '${declared.scope}' was not resolved`),
      );
    }

    return [declared.scope, Object.freeze({ ...resolved })] as const;
  });

  return {
    ...(route.access.kind === "public" ? {} : { principal: frozenPrincipal(grant.principal) }),
    ...(scopes.length === 0 ? {} : { scopes: Object.freeze(Object.fromEntries(scopes)) }),
  };
}

function frozenPrincipal(principal: unknown): unknown {
  if (principal === undefined || principal === null) return null;

  return isPlainObject(principal) ? Object.freeze({ ...principal }) : principal;
}

// Node's `util.inspect` reads this symbol; the input answers with its wire members only, so `%o` or `showHidden`
// never prints the caller.
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

type NodeInspect = (value: unknown, options: unknown) => string;

/**
 * The input a handler receives: a copy of the validated input with its caller's `principal` and `scopes` added as
 * read-only, non-enumerable members, so serialising, spreading or inspecting the input never carries them.
 */
export function inputWithAccess(route: ContractRoute, grant: AccessGrant, input: unknown): object {
  if (input !== undefined && !isPlainObject(input)) {
    throw unexpectedError(route, new Error("seampact: the validated input is not an object"));
  }

  const members = Object.entries(handlerAccess(route, grant)).map(
    ([name, value]) => [name, { value, enumerable: false, writable: false }] as const,
  );

  const wireMembers = { ...input };
  const inspectWireMembers = (_depth: number, options: unknown, inspect: NodeInspect): string =>
    inspect(wireMembers, options);

  return Object.defineProperties(
    { ...input },
    {
      ...Object.fromEntries(members),
      [INSPECT_CUSTOM]: { value: inspectWireMembers, enumerable: false, writable: false },
    },
  );
}
