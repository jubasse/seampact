import { describe, expect, test } from "vitest";
import { authorizeRequest, type CheckState } from "./access-checks.js";
import { type RegisteredHooks, resolvedHooks } from "./boundary-hooks.js";
import { ContractError } from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";

// Failures inside hooks (ADR 0012): a hook that throws or rejects answers the operation's 500 and is never an allow.

const INTERNAL_CODE = "api.internal";
const FORBIDDEN_CODE = "api.forbidden";
const HOOK_BUG = new Error("the hook's backend is down");

const ERRORS = {
  [INTERNAL_CODE]: {
    code: INTERNAL_CODE,
    status: 500,
    nature: "internal",
    roles: ["undeclaredStatus"],
  },
  [FORBIDDEN_CODE]: { code: FORBIDDEN_CODE, status: 403, nature: "forbidden", roles: [] },
  "api.unauthenticated": {
    code: "api.unauthenticated",
    status: 401,
    nature: "unauthenticated",
    roles: ["unauthenticated"],
  },
};

const BEARER_ACCESS = {
  kind: "identity",
  identity: "user",
  anonymousAllowed: false,
  credentials: [{ scheme: "bearer", in: "bearer" }],
  principalValidator: { "~standard": { validate: (value: unknown) => ({ value }) } },
};

function stateFor(routeParts: object, registered: RegisteredHooks): CheckState {
  const route: unknown = {
    id: "getTask",
    method: "get",
    path: "/tasks",
    safe: true,
    errors: ERRORS,
    access: { kind: "public" },
    requires: [],
    scopes: [],
    params: { path: [], query: [], headers: [] },
    validator: { "~standard": { validate: (value: unknown) => ({ value }) } },
    ...routeParts,
  };
  const api: unknown = { id: "tasks" };

  return {
    api: api as ContractApi,
    route: route as ContractRoute,
    request: {
      method: "GET",
      path: "/tasks",
      rawQuery: "",
      headers: { authorization: "Bearer token" },
      body: undefined,
    },
    pathParams: { workspaceId: "w1" },
    hooks: resolvedHooks(registered),
    isFrameworkDenial: (error) => error instanceof RangeError,
    fixes: { rawBody: "", bodySize: "" },
  };
}

async function refusalOf(state: CheckState): Promise<ContractError> {
  const refusal: unknown = await authorizeRequest(state).then(
    () => undefined,
    (error: unknown) => error,
  );

  if (!(refusal instanceof ContractError)) throw new Error("expected a ContractError");

  return refusal;
}

const REQUIRE_RIGHT = {
  requires: [{ kind: "right", name: "tasks.read", errors: [FORBIDDEN_CODE] }],
};

describe("a hook that fails", () => {
  test("a throwing authenticate hook answers the 500 code and keeps the cause for onUnexpectedError", async () => {
    const state = stateFor(
      { access: BEARER_ACCESS },
      {
        authenticate: {
          user: {
            authenticate: () => {
              throw HOOK_BUG;
            },
          },
        },
      },
    );

    const refusal = await refusalOf(state);

    expect(refusal.code).toBe(INTERNAL_CODE);
    expect(refusal.unexpectedCause).toBe(HOOK_BUG);
  });

  test("a rejecting authenticate hook answers the 500 code", async () => {
    const state = stateFor(
      { access: BEARER_ACCESS },
      { authenticate: { user: { authenticate: () => Promise.reject(HOOK_BUG) } } },
    );

    expect((await refusalOf(state)).code).toBe(INTERNAL_CODE);
  });

  test("a throwing decide hook answers the 500 code and never allows", async () => {
    const state = stateFor(REQUIRE_RIGHT, {
      deciders: [
        {
          names: "all",
          decider: {
            decide: () => {
              throw HOOK_BUG;
            },
          },
        },
      ],
    });

    const refusal = await refusalOf(state);

    expect(refusal.code).toBe(INTERNAL_CODE);
    expect(refusal.unexpectedCause).toBe(HOOK_BUG);
  });

  test("a framework denial thrown inside a decide hook answers the first declared denial code", async () => {
    const state = stateFor(REQUIRE_RIGHT, {
      deciders: [
        {
          names: "all",
          decider: {
            decide: () => {
              throw new RangeError("the framework's own denial");
            },
          },
        },
      ],
    });

    expect((await refusalOf(state)).code).toBe(FORBIDDEN_CODE);
  });

  test("a framework denial thrown inside an authenticate hook is still a 500", async () => {
    const state = stateFor(
      { access: BEARER_ACCESS },
      {
        authenticate: {
          user: {
            authenticate: () => {
              throw new RangeError("the framework's own denial");
            },
          },
        },
      },
    );

    expect((await refusalOf(state)).code).toBe(INTERNAL_CODE);
  });

  test("a throwing scope resolver answers the 500 code", async () => {
    const state = stateFor(
      {
        params: { path: [{ name: "workspaceId", decoding: "string" }], query: [], headers: [] },
        scopes: [{ scope: "workspace", source: { in: "path", name: "workspaceId" }, errors: [] }],
      },
      {
        scopeResolvers: {
          workspace: {
            resolveScope: () => {
              throw HOOK_BUG;
            },
          },
        },
      },
    );

    const refusal = await refusalOf(state);

    expect(refusal.code).toBe(INTERNAL_CODE);
    expect(refusal.unexpectedCause).toBe(HOOK_BUG);
  });

  test("a decider that answers allow lets the request through", async () => {
    const state = stateFor(REQUIRE_RIGHT, {
      deciders: [{ names: "all", decider: { decide: () => ({ allow: true }) } }],
    });

    await expect(authorizeRequest(state)).resolves.toMatchObject({ scopes: [] });
  });
});
