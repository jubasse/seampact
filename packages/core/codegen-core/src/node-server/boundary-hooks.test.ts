import { expect, test } from "vitest";
import {
  type BoundaryHooks,
  enforcedHookBootProblems,
  type HookCheckedApi,
} from "../../node-server-runtime/boundary-hooks.js";

function apiWithLevel(hookCheck: HookCheckedApi["hookCheck"]): HookCheckedApi {
  return {
    id: "orders",
    hookCheck,
    routes: [
      {
        id: "orders.refund",
        access: { kind: "public" },
        requires: [{ name: "orders.refund" }],
        fieldRights: [],
        scopes: [],
      },
    ],
  };
}

const decider = () => ({ allow: true });
const hooksClaimingTwice = {
  authenticate: {},
  scopeResolvers: {},
  deciders: [
    { names: ["orders.refund"], decider },
    { names: ["orders.refund"], decider },
  ],
} as unknown as BoundaryHooks;

test.each(["error", "warn", "off"] as const)(
  "a right claimed by two deciders stops the boot at hooks level %s",
  (level) => {
    const problems = enforcedHookBootProblems(apiWithLevel(level), hooksClaimingTwice);

    expect(problems.map((problem) => problem.problem)).toEqual([
      "two deciders claim 'orders.refund'",
    ]);
  },
);

test("a missing decider stops the boot at error only", () => {
  const hooks = { authenticate: {}, scopeResolvers: {}, deciders: [] } as unknown as BoundaryHooks;

  expect(enforcedHookBootProblems(apiWithLevel("error"), hooks)).toHaveLength(1);
  expect(enforcedHookBootProblems(apiWithLevel("off"), hooks)).toEqual([]);
});
