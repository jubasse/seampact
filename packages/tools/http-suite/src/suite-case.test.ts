import { describe, expect, test } from "vitest";
import { loadSuiteCases } from "./load-cases.js";
import { parseSuiteCase, SuiteCaseError } from "./suite-case.js";

const SOURCE = "case.json";

function minimalCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "health-answers",
    title: "Health answers",
    checks: ["CHK-012"],
    profiles: ["default"],
    steps: [{ request: { method: "GET", path: "/v1/health" }, expect: { status: 200 } }],
    ...overrides,
  };
}

describe("parseSuiteCase", () => {
  test("reads a case and copies its JSON values", () => {
    const body = { title: "Write" };
    const parsed = parseSuiteCase(
      minimalCase({
        steps: [
          {
            title: "create",
            request: {
              method: "POST",
              path: "/v1/tasks",
              body,
              sign: { scheme: "stripe-v1", header: "stripe-signature", secret: "s" },
            },
            capture: {
              taskId: { body: "/taskId" },
              cursor: { header: "link", pattern: "cursor=([^&>]+)" },
            },
            expect: {
              status: 201,
              headers: { link: { contains: ['rel="next"'] } },
              body: { title: "Write" },
            },
          },
        ],
      }),
      SOURCE,
    );

    body.title = "changed";

    expect(parsed.steps[0]?.request.body).toEqual({ title: "Write" });
    expect(parsed.steps[0]?.capture).toEqual({
      taskId: { body: "/taskId" },
      cursor: { header: "link", pattern: "cursor=([^&>]+)" },
    });
  });

  test.each([
    ["an unknown member", minimalCase({ extra: 1 }), "at '/extra': unknown member"],
    ["a checklist id of another form", minimalCase({ checks: ["CHK-12"] }), "at '/checks/0'"],
    ["an unknown profile", minimalCase({ profiles: ["fast"] }), "at '/profiles/0'"],
    ["no step", minimalCase({ steps: [] }), "at '/steps': a case has at least one step"],
    [
      "a relative path",
      minimalCase({ steps: [{ request: { method: "GET", path: "v1" }, expect: { status: 200 } }] }),
      "at '/steps/0/request/path'",
    ],
    [
      "an uppercase header name",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/", headers: { Accept: "x" } },
            expect: { status: 200 },
          },
        ],
      }),
      "at '/steps/0/request/headers/Accept': header names are lowercase",
    ],
    [
      "a status out of range",
      minimalCase({ steps: [{ request: { method: "GET", path: "/" }, expect: { status: 42 } }] }),
      "at '/steps/0/expect/status'",
    ],
    [
      "a header pattern without a group",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/" },
            capture: { cursor: { header: "link", pattern: "cursor=.+" } },
            expect: { status: 200 },
          },
        ],
      }),
      "at '/steps/0/capture/cursor/pattern': the pattern holds a capturing group",
    ],
    [
      "two checks in one header expectation",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/" },
            expect: { status: 200, headers: { link: { absent: true, equals: "x" } } },
          },
        ],
      }),
      "at '/steps/0/expect/headers/link': a header expectation holds one of",
    ],
    [
      "an empty contains list",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/" },
            expect: { status: 200, headers: { link: { contains: [] } } },
          },
        ],
      }),
      "at '/steps/0/expect/headers/link/contains': `contains` lists at least one text",
    ],
    [
      "a capture named like a credential",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/" },
            capture: { userToken: { body: "/token" } },
            expect: { status: 200 },
          },
        ],
      }),
      "at '/steps/0/capture/userToken': a capture cannot take the name of a credential",
    ],
    [
      "a body beside a body text",
      minimalCase({
        steps: [
          {
            request: { method: "POST", path: "/", body: {}, bodyText: "{" },
            expect: { status: 400 },
          },
        ],
      }),
      "at '/steps/0/request': a request sends either `body` or `bodyText`, not both",
    ],
    [
      "a negative signature age",
      minimalCase({
        steps: [
          {
            request: {
              method: "POST",
              path: "/",
              sign: {
                scheme: "stripe-v1",
                header: "stripe-signature",
                secret: "s",
                ageSeconds: -1,
              },
            },
            expect: { status: 200 },
          },
        ],
      }),
      "at '/steps/0/request/sign/ageSeconds'",
    ],
    [
      "an absent pointer without a slash",
      minimalCase({
        steps: [
          {
            request: { method: "GET", path: "/" },
            expect: { status: 200, absent: ["nextCursor"] },
          },
        ],
      }),
      "at '/steps/0/expect/absent/0'",
    ],
  ])("refuses %s by its pointer", (_case, value, message) => {
    expect(() => parseSuiteCase(value, SOURCE)).toThrow(SuiteCaseError);
    expect(() => parseSuiteCase(value, SOURCE)).toThrow(message);
  });
});

describe("loadSuiteCases", () => {
  test("reads every shipped case of the default profile, named after its id", () => {
    const cases = loadSuiteCases("default");

    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((suiteCase) => suiteCase.id)).size).toBe(cases.length);
  });
});
