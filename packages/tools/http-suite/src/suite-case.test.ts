import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { CASES_DIRECTORY, loadSuiteCases } from "./load-cases.js";
import { parseSuiteCase, type SuiteCase, SuiteCaseError } from "./suite-case.js";

const SOURCE = "case.json";
const REFERENCE_WORKSPACE = fileURLToPath(
  new URL("../../../../fixtures/reference/workspace.yaml", import.meta.url),
);

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

function bootCase(boot: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: "missing-decider-refused",
    title: "Refused",
    checks: ["CHK-062"],
    profiles: ["boot"],
    boot,
    ...overrides,
  };
}

describe("parseSuiteCase, boot cases", () => {
  test("reads a refusal with its diagnostic and a start, both without steps", () => {
    const refusal = { variant: "missing-decider", outcome: "refuses", diagnostic: ["no decider"] };

    expect(parseSuiteCase(bootCase(refusal), SOURCE)).toMatchObject({ steps: [], boot: refusal });
    expect(
      parseSuiteCase(
        bootCase({ variant: "allow-listed-framework-route", outcome: "starts" }),
        SOURCE,
      ).boot,
    ).toEqual({ variant: "allow-listed-framework-route", outcome: "starts" });
  });

  test.each([
    [bootCase({ variant: "missing-decider", outcome: "refuses" }), "/boot/diagnostic"],
    [
      bootCase({ variant: "missing-decider", outcome: "refuses", diagnostic: [] }),
      "/boot/diagnostic",
    ],
    [
      bootCase({ variant: "missing-decider", outcome: "starts", diagnostic: ["x"] }),
      "/boot/diagnostic",
    ],
    [bootCase({ variant: "missing-cache", outcome: "starts" }), "/boot/variant"],
    [bootCase({ variant: "missing-decider", outcome: "hangs" }), "/boot/outcome"],
    [
      bootCase(
        { variant: "missing-decider", outcome: "starts" },
        { profiles: ["boot", "default"] },
      ),
      "/profiles",
    ],
    [bootCase({ variant: "missing-decider", outcome: "starts" }, { steps: [] }), "/steps"],
    [minimalCase({ boot: { variant: "missing-decider", outcome: "starts" } }), "/boot"],
  ])("refuses a malformed boot case %#", (value, pointer) => {
    expect(() => parseSuiteCase(value, SOURCE)).toThrow(`at '${pointer}'`);
  });
});

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
    [
      "a scoped check without a target",
      minimalCase({ checks: [{ id: "CHK-012", targets: [] }] }),
      "at '/checks/0/targets': a scoped check names at least one target",
    ],
    [
      "a scoped check with an unknown member",
      minimalCase({ checks: [{ id: "CHK-012", targets: ["nestjs"], only: true }] }),
      "at '/checks/0/only': unknown member",
    ],
    ["an unknown profile", minimalCase({ profiles: ["fast"] }), "at '/profiles/0'"],
    ["no step", minimalCase({ steps: [] }), "at '/steps': a case has at least one step"],
    ["an empty api list", minimalCase({ apis: [] }), "at '/apis': `apis` names at least one api"],
    ["an api of another form", minimalCase({ apis: ["tasks-devices"] }), "at '/apis/0'"],
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

  // A typo in `apis` would make a pack profile refuse the case as an api its app does not serve.
  test("names in each shipped case's apis only apis of the reference workspace", () => {
    const referenceApis = new Set(referenceWorkspaceApis());
    const unknownApis = shippedCases().flatMap((suiteCase) =>
      (suiteCase.apis ?? [])
        .filter((api) => !referenceApis.has(api))
        .map((api) => `${suiteCase.id}: '${api}' is not an api of the reference workspace`),
    );

    expect(referenceApis.size).toBeGreaterThan(0);
    expect(unknownApis).toEqual([]);
  });
});

function shippedCases(): SuiteCase[] {
  return readdirSync(CASES_DIRECTORY)
    .sort()
    .map((file) =>
      parseSuiteCase(JSON.parse(readFileSync(join(CASES_DIRECTORY, file), "utf8")), file),
    );
}

function referenceWorkspaceApis(): string[] {
  const workspace: unknown = parse(readFileSync(REFERENCE_WORKSPACE, "utf8"));
  const apis =
    isRecord(workspace) && isRecord(workspace.workspace) ? workspace.workspace.apis : undefined;

  if (!isRecord(apis)) throw new Error(`${REFERENCE_WORKSPACE} has no workspace.apis map`);

  return Object.keys(apis);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
