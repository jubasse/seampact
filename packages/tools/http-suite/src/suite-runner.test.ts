import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOOK_CALLS_ROUTE, readLogLines, SCRIPT_ROUTE } from "./control-routes.js";
import { parseSuiteCase, type SuiteCase, type SuiteProfile } from "./suite-case.js";
import { SUITE_REPORT_FORMAT } from "./suite-report.js";
import { runSuite, type SuiteCredentials } from "./suite-runner.js";

const CREDENTIALS: SuiteCredentials = {
  userToken: "user-token",
  throttledUserToken: "throttled-token",
  serviceJwt: "service-jwt",
  stripeSecret: "whsec_test",
  throttleRetryAfterMs: 1500,
  foreignServiceJwt: "foreign-service-jwt",
};
const NEXT_CURSOR = "c%2B2";
const HOOK_CALLS = [{ hook: "authenticate", operation: "getTask" }];

// A sample app double: pages, echoes, a signed route, and the control routes.
let server: Server;
let baseUrl: string;
let loadedScripts: unknown[];

beforeAll(async () => {
  loadedScripts = [];
  server = createServer((request, response) => {
    void answer(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address: AddressInfo | string | null = server.address();

  if (address === null || typeof address === "string") throw new Error("no TCP port");

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  const body = Buffer.concat(chunks).toString("utf8");
  const url = new URL(request.url ?? "/", baseUrl);
  const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(value));
  };

  if (url.pathname === SCRIPT_ROUTE) {
    loadedScripts.push(JSON.parse(body));
    response.writeHead(204).end();
  } else if (url.pathname === HOOK_CALLS_ROUTE) {
    json(200, { calls: HOOK_CALLS });
  } else if (url.pathname === "/items" && url.searchParams.get("cursor") === null) {
    json(200, [1], { link: `</items?cursor=${NEXT_CURSOR}>; rel="next"` });
  } else if (url.pathname === "/items") {
    json(200, { cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") });
  } else if (url.pathname === "/links") {
    json(200, {
      cursor: url.searchParams.get("cursor"),
      offsite: "@evil.example/x",
      schemeRelative: "//evil.example/x",
      absolute: "https://evil.example/x",
      queryOnly: "?cursor=b",
      relativePath: "items?cursor=r",
      self: "/items?cursor=a",
    });
  } else if (url.pathname.startsWith("/@")) {
    json(200, { reached: url.pathname });
  } else if (url.pathname === "/echo") {
    json(201, {
      body: JSON.parse(body),
      authorization: request.headers.authorization,
      key: request.headers["idempotency-key"],
    });
  } else if (url.pathname === "/raw") {
    json(200, { text: body, signatureAgeSeconds: signatureAgeSeconds(request) });
  } else if (url.pathname === "/signed") {
    const signature = String(request.headers["stripe-signature"]);

    json(200, { valid: signature === stripeV1(body, signedTimestampOf(signature)) });
  } else {
    json(404, { code: "api.not_found" });
  }
}

// Like a real verifier, the double signs with the header's timestamp, so a request that crosses a second still matches.
function stripeV1(body: string, timestamp: string): string {
  const mac = createHmac("sha256", CREDENTIALS.stripeSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return `t=${timestamp},v1=${mac}`;
}

function signedTimestampOf(signature: string): string {
  return /^t=(\d+),/.exec(signature)?.[1] ?? "";
}

function signatureAgeSeconds(request: IncomingMessage): number {
  const timestamp = signedTimestampOf(String(request.headers["stripe-signature"]));

  return Math.floor(Date.now() / 1000) - Number(timestamp);
}

const TARGET = "double";

function suiteCase(id: string, value: Record<string, unknown>): SuiteCase {
  return parseSuiteCase({ id, title: id, checks: [], profiles: ["default"], ...value }, id);
}

async function run(
  cases: SuiteCase[],
  refusals?: Record<string, string>,
  profile: SuiteProfile = "default",
) {
  return runSuite({
    baseUrl,
    target: TARGET,
    profile,
    credentials: CREDENTIALS,
    cases,
    ...(refusals === undefined ? {} : { refusals }),
  });
}

describe("runSuite", () => {
  test("captures a header value, fills placeholders and keeps one uuid per label", async () => {
    const report = await run([
      suiteCase("paging-and-echo", {
        steps: [
          {
            request: { method: "GET", path: "/items" },
            capture: { cursor: { header: "link", pattern: "cursor=([^&>]+)" } },
            expect: { status: 200, headers: { link: { contains: ["cursor={{cursor}}"] } } },
          },
          {
            request: { method: "GET", path: "/items?cursor={{cursor}}", query: { limit: 10 } },
            expect: { status: 200, body: { cursor: "c+2", limit: "10" } },
          },
          {
            request: {
              method: "POST",
              path: "/echo",
              headers: { authorization: "Bearer {{userToken}}", "idempotency-key": "{{uuid:k}}" },
              body: { delay: "{{throttleRetryAfterMs}}", seconds: "{{throttleRetryAfterSeconds}}" },
            },
            capture: { first: { body: "" } },
            expect: { status: 201, body: { body: { delay: 1500, seconds: "2" } } },
          },
          {
            request: {
              method: "POST",
              path: "/echo",
              headers: { authorization: "Bearer {{userToken}}", "idempotency-key": "{{uuid:k}}" },
              body: { delay: "{{throttleRetryAfterMs}}", seconds: "{{throttleRetryAfterSeconds}}" },
            },
            expect: { status: 201, body: "{{first}}" },
          },
        ],
      }),
    ]);

    expect(report.cases[0]).toMatchObject({ outcome: "passed", failures: [] });
  });

  test("signs the body it sends", async () => {
    const report = await run([
      suiteCase("signed", {
        steps: [
          {
            request: {
              method: "POST",
              path: "/signed",
              body: { id: "evt_1" },
              sign: { scheme: "stripe-v1", header: "stripe-signature", secret: "{{stripeSecret}}" },
            },
            expect: { status: 200, body: { valid: true } },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([]);
  });

  test("sends a body text as written, signed as of `ageSeconds` ago", async () => {
    const report = await run([
      suiteCase("raw", {
        steps: [
          {
            request: {
              method: "POST",
              path: "/raw",
              bodyText: '{"title":',
              sign: {
                scheme: "stripe-v1",
                header: "stripe-signature",
                secret: "{{stripeSecret}}",
                ageSeconds: 600,
              },
            },
            expect: { status: 200, body: { text: '{"title":', signatureAgeSeconds: 600 } },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([]);
  });

  test("names every mismatch of a step and an unknown placeholder", async () => {
    const report = await run([
      suiteCase("mismatches", {
        steps: [
          {
            request: { method: "GET", path: "/missing" },
            expect: {
              status: 200,
              headers: { "content-type": { contains: ["problem"] }, link: { equals: "x" } },
              body: { code: "api.other", extra: [1] },
            },
          },
          { request: { method: "GET", path: "/{{nobody}}" }, expect: { status: 200 } },
        ],
      }),
    ]);

    expect(report.cases[0]?.outcome).toBe("failed");
    expect(report.cases[0]?.failures).toEqual([
      expect.stringContaining("step 0 (GET /missing): status 404, expected 200"),
      "step 0 (GET /missing): header 'content-type' is 'application/json', expected to contain 'problem'",
      "step 0 (GET /missing): header 'link' is absent",
      `step 0 (GET /missing): body at '/code' is "api.not_found", expected "api.other"`,
      "step 0 (GET /missing): body member '/extra' is absent, expected [1]",
      expect.stringContaining("no value for '{{nobody}}'"),
    ]);
  });

  test("loads each case's script, an empty one by default, and compares the recorded hook calls", async () => {
    const step = { request: { method: "GET", path: "/missing" }, expect: { status: 404 } };

    loadedScripts.length = 0;

    const report = await run([
      suiteCase("scripted", {
        script: { decisions: [{ name: "roles", deny: { code: "api.forbidden" } }] },
        steps: [step],
        hookCalls: HOOK_CALLS,
      }),
      suiteCase("other-calls", { steps: [step], hookCalls: [] }),
    ]);

    expect(loadedScripts).toEqual([
      { decisions: [{ name: "roles", deny: { code: "api.forbidden" } }] },
      {},
    ]);
    expect(report.cases.map((result) => result.outcome)).toEqual(["passed", "failed"]);
    await expect(readLogLines(baseUrl, AbortSignal.timeout(1000))).rejects.toThrow("answered 404");
  });

  test("reports refused cases and the outcome of each checklist id", async () => {
    const step = { request: { method: "GET", path: "/items" }, expect: { status: 200 } };
    const cases = [
      parseSuiteCase(
        {
          id: "a",
          title: "a",
          checks: ["CHK-001", "CHK-002"],
          profiles: ["default"],
          steps: [step],
        },
        "a",
      ),
      parseSuiteCase(
        { id: "b", title: "b", checks: ["CHK-002"], profiles: ["default"], steps: [step] },
        "b",
      ),
    ];
    const report = await run(cases, { b: "the sample app has no such route" });

    expect(report.summary).toEqual({ passed: 1, failed: 0, refused: 1 });
    expect(report.cases[1]).toMatchObject({
      outcome: "refused",
      reason: "the sample app has no such route",
    });
    expect(report.checks).toEqual({
      "CHK-001": { outcome: "passed", cases: ["a"] },
      "CHK-002": { outcome: "refused", cases: ["a", "b"] },
    });
  });

  test("a failed case fails its checklist id and the report names its format", async () => {
    const passing = { request: { method: "GET", path: "/items" }, expect: { status: 200 } };
    const failing = { request: { method: "GET", path: "/items" }, expect: { status: 500 } };
    const report = await run([
      suiteCase("good", { checks: ["CHK-003"], steps: [passing] }),
      suiteCase("bad", { checks: ["CHK-003"], steps: [failing] }),
    ]);

    expect(report.format).toBe(SUITE_REPORT_FORMAT);
    expect(report.target).toBe(TARGET);
    expect(report.checks).toEqual({ "CHK-003": { outcome: "failed", cases: ["good", "bad"] } });
  });

  test("the hand-written profile proves its profile check with every case of the run", async () => {
    const step = { request: { method: "GET", path: "/items" }, expect: { status: 200 } };
    const handWritten = (id: string, checks: string[]) =>
      parseSuiteCase({ id, title: id, checks, profiles: ["hand-written"], steps: [step] }, id);
    const report = await run(
      [handWritten("a", ["CHK-018"]), handWritten("b", [])],
      { b: "a target bug" },
      "hand-written",
    );

    expect(report.profile).toBe("hand-written");
    expect(report.checks).toEqual({
      "CHK-018": { outcome: "passed", cases: ["a"] },
      "CHK-098": { outcome: "refused", cases: ["a", "b"] },
    });
  });

  test("refuses the boot profile, whose cases send no request", async () => {
    await expect(run([], undefined, "boot")).rejects.toThrow("runBootSuite");
  });

  test("refuses a refusal for a case the run does not hold", async () => {
    await expect(run([], { ghost: "no reason" })).rejects.toThrow("ghost");
  });

  test("a failed capture still reports the status that explains it", async () => {
    const report = await run([
      suiteCase("capture-on-error", {
        steps: [
          {
            request: { method: "GET", path: "/missing" },
            capture: { taskId: { body: "/taskId" } },
            expect: { status: 200 },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([
      expect.stringContaining("capture 'taskId'"),
      expect.stringContaining("status 404, expected 200"),
    ]);
  });

  test.each(["schemeRelative", "absolute"])(
    "fails a path filled from the %s link, which leaves the target",
    async (link) => {
      const report = await run([
        suiteCase("leaves-target", {
          steps: [
            {
              request: { method: "GET", path: "/links" },
              capture: { link: { body: `/${link}` } },
              expect: { status: 200 },
            },
            { request: { method: "GET", path: "{{link}}" }, expect: { status: 200 } },
          ],
        }),
      ]);

      expect(report.cases[0]?.failures).toEqual([
        expect.stringContaining("the path '{{link}}' fills to '"),
      ]);
      expect(report.cases[0]?.failures[0]).toContain("which does not start with one '/'");
    },
  );

  test.each([
    ["queryOnly", { cursor: "b" }],
    ["relativePath", { cursor: "r", limit: null }],
    ["offsite", { reached: "/@evil.example/x" }],
  ])(
    "resolves the captured %s link against the URL of the request it came from",
    async (link, body) => {
      const report = await run([
        suiteCase("resolved-link", {
          steps: [
            {
              request: { method: "GET", path: "/links", query: { cursor: "a" } },
              capture: { link: { body: `/${link}` } },
              expect: { status: 200, body: { cursor: "a" } },
            },
            { request: { method: "GET", path: "{{link}}" }, expect: { status: 200, body } },
          ],
        }),
      ]);

      expect(report.cases[0]).toMatchObject({ outcome: "passed", failures: [] });
    },
  );

  test("appends a step's query to a filled path that already holds one", async () => {
    const report = await run([
      suiteCase("filled-query", {
        steps: [
          {
            request: { method: "GET", path: "/links" },
            capture: { self: { body: "/self" } },
            expect: { status: 200 },
          },
          {
            request: { method: "GET", path: "{{self}}", query: { limit: 2 } },
            expect: { status: 200, body: { cursor: "a", limit: "2" } },
          },
        ],
      }),
    ]);

    expect(report.cases[0]).toMatchObject({ outcome: "passed", failures: [] });
  });

  test("checks that a body member is absent and that array pointers take indexes only", async () => {
    const report = await run([
      suiteCase("absent-members", {
        steps: [
          {
            request: { method: "GET", path: "/items" },
            capture: { length: { body: "/length" } },
            expect: { status: 200, absent: ["/0", "/length"] },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([
      expect.stringContaining("capture 'length'"),
      "step 0 (GET /items): body member '/0' is 1, expected absent",
    ]);
  });
});
