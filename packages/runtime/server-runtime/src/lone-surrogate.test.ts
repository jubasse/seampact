import { expect, test } from "vitest";
import type { CheckState } from "./access-checks.js";
import type { ContractRoute } from "./contract-route.js";
import { validateRequest } from "./input-issues.js";
import { holdsLoneSurrogate } from "./lone-surrogate.js";

const LONE = "a\uD800";
const LARGE_BODY_ITEMS = 300_000;

test.each([
  ["a string", LONE],
  ["a member value", { title: LONE }],
  ["a nested array item", { tags: [["ok", LONE]] }],
  ["a key", { [LONE]: 1 }],
  ["a nested key", { labels: [{ [LONE]: "x" }] }],
])("%s holding a lone surrogate is found", (_name, tree) => {
  expect(holdsLoneSurrogate(tree)).toBe(true);
});

test.each([
  ["a pair", "a\u{1F600}"],
  ["no string", { count: 1, flag: null }],
  ["an empty body", undefined],
])("%s is accepted", (_name, tree) => {
  expect(holdsLoneSurrogate(tree)).toBe(false);
});

test("an array of 300k items is walked without overflowing the stack", () => {
  const items = Array.from({ length: LARGE_BODY_ITEMS }, (_unused, index) => index);

  expect(holdsLoneSurrogate({ items })).toBe(false);
  expect(holdsLoneSurrogate([...items, LONE])).toBe(true);
});

test("an object of 300k keys is walked without overflowing the stack", () => {
  const counts = Object.fromEntries(
    Array.from({ length: LARGE_BODY_ITEMS }, (_unused, index) => [`k${index}`, index]),
  );

  expect(holdsLoneSurrogate(counts)).toBe(false);
});

// A route of the shape a generated table holds, with a body input and a validator that counts its calls.
function routeWithBody(validatorCalls: unknown[]): ContractRoute {
  const route: unknown = {
    id: "createTask",
    input: {},
    params: { path: [], query: [], headers: [] },
    validator: {
      "~standard": {
        validate: (candidate: unknown) => {
          validatorCalls.push(candidate);

          return { value: candidate };
        },
      },
    },
  };

  return route as ContractRoute;
}

test("a request body holding a lone surrogate is refused as a body type issue before the validator", async () => {
  const validatorCalls: unknown[] = [];
  const state: unknown = {
    route: routeWithBody(validatorCalls),
    request: { method: "POST", path: "/tasks", rawQuery: "", headers: {}, body: { title: LONE } },
    pathParams: {},
  };

  const validation = await validateRequest(state as CheckState);

  expect(validation.issues).toEqual([{ in: "body", pointer: "", rule: "type" }]);
  expect(validatorCalls).toEqual([]);
});
