import { describe, expect, test } from "vitest";
import { type ContractRoute, statusError } from "./index.js";

// The shared status rule of the runtime, read through a route of the shape a generated table holds.

const FIXES = { requiredParams: "answer it from the handler", severalCodes: "pick one" };

// A route whose rateLimited code has an optional `retryAfterMs`, bound from the role's data.
function routeWithOptionalDelay(): ContractRoute {
  const route: unknown = {
    id: "createTask",
    errors: {
      "api.rate_limited": {
        code: "api.rate_limited",
        status: 429,
        nature: "rateLimited",
        roles: ["rateLimited"],
        roleParams: {
          rateLimited: {
            kind: "object",
            members: [
              { name: "retryAfterMs", value: { kind: "slot", slot: "retryAfterMs", path: [] } },
            ],
          },
        },
      },
    },
  };

  return route as ContractRoute;
}

describe("a 429 whose rateLimited code has an optional retryAfterMs", () => {
  test("fills the delay when the throttler gave one", () => {
    const error = statusError(routeWithOptionalDelay(), 429, undefined, FIXES, {
      retryAfterMs: 2000,
    });

    expect(error.code).toBe("api.rate_limited");
    expect(error.params).toEqual({ retryAfterMs: 2000 });
  });

  test("answers the bare code without a delay", () => {
    const error = statusError(routeWithOptionalDelay(), 429, undefined, FIXES);

    expect(error.code).toBe("api.rate_limited");
    expect(error.params).toBeUndefined();
  });
});
