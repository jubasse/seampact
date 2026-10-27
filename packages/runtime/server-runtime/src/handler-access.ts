// What a handler reads of its caller beside its input (ADR 0012 "Open tenancy"): the principal and the resolved
// scopes of the request the boundary checked, read-only and outside the wire input.
import type { ResolvedScope } from "@seampact/hooks";
import type { AccessGrant } from "./access-checks.js";
import { unexpectedError } from "./contract-error.js";
import type { ContractRoute } from "./contract-route.js";
import { isPlainObject } from "./plain-object.js";

/** The caller of an operation: its principal (null when anonymous) and each scope it runs in, by scope name. */
export interface HandlerAccess<
  Principal = unknown,
  Scopes extends Readonly<Record<string, ResolvedScope>> = Readonly<Record<string, ResolvedScope>>,
> {
  readonly principal: Principal;
  readonly scopes: Scopes;
}

/** The principal and the scopes of a granted request, the scopes keyed by the route's declared scope names. */
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
    principal: grant.principal ?? null,
    scopes: Object.freeze(Object.fromEntries(scopes)),
  };
}

/**
 * The input a handler receives: a copy of the validated input with `principal` and `scopes` added as read-only,
 * non-enumerable members, so serialising or spreading the input never carries them.
 */
export function inputWithAccess(route: ContractRoute, grant: AccessGrant, input: unknown): object {
  if (input !== undefined && !isPlainObject(input)) {
    throw unexpectedError(route, new Error("seampact: the validated input is not an object"));
  }

  const access = handlerAccess(route, grant);

  return Object.defineProperties(
    { ...input },
    {
      principal: { value: access.principal, enumerable: false, writable: false },
      scopes: { value: access.scopes, enumerable: false, writable: false },
    },
  );
}
