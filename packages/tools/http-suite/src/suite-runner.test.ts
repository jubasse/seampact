import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "./control-routes.js";
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
  deviceToken: "device-token",
};
const NEXT_CURSOR = "c%2B2";
const BUCKET = { id: "write", values: ["user-1"], limit: 60, windowMs: 60000 };
const HOOK_CALLS = [
  { hook: "authenticate", operation: "getTask" },
  { hook: "decide:throttle", operation: "getTask", bucket: BUCKET },
];
// The calls as a sample app may write them, members in another order.
const RECORDED_HOOK_CALLS = [
  { operation: "getTask", hook: "authenticate" },
  {
    bucket: { windowMs: 60000, limit: 60, values: ["user-1"], id: "write" },
    operation: "getTask",
    hook: "decide:throttle",
  },
];

// A sample app double: pages, echoes, a signed route, a route that logs its body, and the control routes.
let server: Server;
let baseUrl: string;
let loadedScripts: unknown[];
const logLines: string[] = [];
// The double's held request: its hook call while it waits, and its release, the next script load.
const HOLD_CALL = { hook: "hold", operation: "tasks.createTask" };
let holdCalls: (typeof HOLD_CALL)[] = [];
let releaseHeld: (() => void) | undefined;

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

  const received = Buffer.concat(chunks);
  const body = received.toString("utf8");
  const url = new URL(request.url ?? "/", baseUrl);
  const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(value));
  };

  if (url.pathname === SCRIPT_ROUTE) {
    loadedScripts.push(JSON.parse(body));
    logLines.length = 0;
    holdCalls = [];
    releaseHeld?.();
    response.writeHead(204).end();
  } else if (url.pathname === HOOK_CALLS_ROUTE) {
    json(200, { calls: [...RECORDED_HOOK_CALLS, ...holdCalls] });
  } else if (url.pathname === "/held" && releaseHeld !== undefined) {
    json(409, { code: "api.idempotency_in_progress" });
  } else if (url.pathname === "/held") {
    await new Promise<void>((resolve) => {
      releaseHeld = resolve;
      holdCalls.push(HOLD_CALL);
    });
    releaseHeld = undefined;
    json(201, { text: body });
  } else if (url.pathname === "/gunzip") {
    json(200, {
      encoding: request.headers["content-encoding"],
      text: gunzipSync(received).toString("utf8"),
    });
  } else if (url.pathname === "/dropped") {
    request.socket.destroy();
  } else if (url.pathname === LOG_LINES_ROUTE) {
    json(200, { lines: logLines });
  } else if (url.pathname === "/log") {
    logLines.push(`received ${body}`);
    json(202, {});
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
  } else if (url.pathname === "/host") {
    json(
      200,
      { host: request.headers.host, forwardedHost: request.headers["x-forwarded-host"] },
      {
        link: '<https://origin.example/host>; rel="self"',
      },
    );
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

// Just before a whole second, where a running clock would tick between signing and checking.
const FROZEN_SIGNING_TIME = Date.UTC(2026, 0, 1, 0, 0, 0, 999);

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

  test("the input-rule pointers are the body root unless the run states its library's", async () => {
    const pointerCase = suiteCase("input-rule-pointers", {
      steps: [
        {
          request: { method: "POST", path: "/echo", body: { pointer: "/start" } },
          expect: { status: 201, body: { body: { pointer: "{{inputRulesCrossMemberPointer}}" } } },
        },
      ],
    });
    const atRoot = await run([pointerCase]);
    const atMember = await runSuite({
      baseUrl,
      target: TARGET,
      profile: "default",
      credentials: CREDENTIALS,
      cases: [pointerCase],
      inputRulePointers: { crossMember: "/start", unnamed: "/note" },
    });

    expect(atRoot.cases[0]?.outcome).toBe("failed");
    expect(atMember.cases[0]).toMatchObject({ outcome: "passed", failures: [] });
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
    // The runner signs and the double measures the age at two moments; a frozen clock keeps a second tick between them
    // from reading as 601. Only Date is faked, so the sockets keep their real timers.
    vi.useFakeTimers({ toFake: ["Date"], now: FROZEN_SIGNING_TIME });
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
    ]).finally(() => vi.useRealTimers());

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

  test("loads each case's script, an empty one by default, and compares the recorded hook calls and buckets", async () => {
    const step = { request: { method: "GET", path: "/missing" }, expect: { status: 404 } };

    loadedScripts.length = 0;

    const report = await run([
      suiteCase("scripted", {
        script: { decisions: [{ name: "roles", deny: { code: "api.forbidden" } }] },
        steps: [step],
        hookCalls: HOOK_CALLS,
      }),
      suiteCase("other-calls", { steps: [step], hookCalls: [] }),
      suiteCase("other-bucket-values", {
        steps: [step],
        hookCalls: [HOOK_CALLS[0], { ...HOOK_CALLS[1], bucket: { ...BUCKET, values: ["user-2"] } }],
      }),
    ]);

    expect(loadedScripts).toEqual([
      { decisions: [{ name: "roles", deny: { code: "api.forbidden" } }] },
      {},
      {},
    ]);
    expect(report.cases.map((result) => result.outcome)).toEqual(["passed", "failed", "failed"]);
  });

  test("runs a background request beside the steps after it and checks it once they have run", async () => {
    const report = await run([
      suiteCase("held", {
        steps: [
          {
            request: { method: "POST", path: "/held", body: { title: "first" } },
            background: true,
            expect: { status: 201, bodyText: '{"text":"{\\"title\\":\\"first\\"}"}' },
          },
          {
            waitForHookCall: HOLD_CALL,
            request: { method: "POST", path: "/held" },
            capture: { refusal: { bodyText: true } },
            expect: { status: 409, bodyText: '{"code":"api.idempotency_in_progress"}' },
          },
          { script: {} },
          {
            request: { method: "GET", path: "/missing" },
            expect: { status: 404 },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([]);
    expect(loadedScripts.at(-1)).toEqual({});
  });

  test("releases a held background request when a later step throws", async () => {
    const report = await run([
      suiteCase("held-then-dropped", {
        steps: [
          {
            request: { method: "POST", path: "/held", body: { title: "first" } },
            background: true,
            expect: { status: 201 },
          },
          {
            waitForHookCall: HOLD_CALL,
            request: { method: "GET", path: "/dropped" },
            expect: { status: 200 },
          },
        ],
      }),
    ]);
    const stillHeld = releaseHeld !== undefined;

    releaseHeld?.();

    expect(stillHeld).toBe(false);
    expect(report.cases[0]?.outcome).toBe("failed");
    expect(loadedScripts.at(-1)).toEqual({});
  });

  test("reports a background request that fails once the later steps have run", async () => {
    const report = await run([
      suiteCase("background-fails", {
        steps: [
          {
            request: { method: "GET", path: "/missing" },
            background: true,
            expect: { status: 200 },
          },
          { request: { method: "GET", path: "/missing" }, expect: { status: 404 } },
        ],
      }),
    ]);

    expect(report.cases[0]?.outcome).toBe("failed");
    expect(report.cases[0]?.failures).toEqual([
      expect.stringMatching(/^step 0 \(GET \/missing\): .*404/),
    ]);
  });

  test("sends no request when the awaited hook call is not recorded in time", async () => {
    const awaited = { hook: "never", operation: "tasks.createTask" };
    const report = await runSuite({
      baseUrl,
      target: TARGET,
      profile: "default",
      credentials: CREDENTIALS,
      requestTimeoutMs: 100,
      cases: [
        suiteCase("never-recorded", {
          steps: [
            {
              waitForHookCall: awaited,
              request: { method: "POST", path: "/log", body: { text: "sent" } },
              expect: { status: 202 },
            },
          ],
        }),
      ],
    });

    expect(report.cases[0]?.failures).toEqual([
      `step 0 (POST /log): the sample app recorded no hook call ${JSON.stringify(awaited)} within 100 ms, so the request was not sent`,
    ]);
    expect(logLines).toEqual([]);
  });

  test("refuses a background step that captures", () => {
    expect(() =>
      suiteCase("background-capture", {
        steps: [
          {
            request: { method: "GET", path: "/missing" },
            background: true,
            capture: { code: { body: "/code" } },
            expect: { status: 404 },
          },
        ],
      }),
    ).toThrow("a background step captures nothing");
  });

  test("checks only the lines the app logged while the step ran", async () => {
    const logged = (text: string) => ({
      request: { method: "POST", path: "/log", body: { text } },
      expect: { status: 202 },
    });
    const checked = (text: string) => ({
      ...logged(text),
      expect: { status: 202, logLines: { contains: ["received"], excludes: ["s3cret"] } },
    });

    const report = await run([
      suiteCase("leaks", { steps: [checked("s3cret")] }),
      suiteCase("earlier-step-leaks", { steps: [logged("s3cret"), checked("plain")] }),
      suiteCase("logs-nothing", {
        steps: [
          {
            request: { method: "GET", path: "/missing" },
            expect: { status: 404, logLines: { contains: ["received"] } },
          },
        ],
      }),
    ]);

    expect(report.cases.map((result) => result.outcome)).toEqual(["failed", "passed", "failed"]);
    expect(report.cases[0]?.failures).toEqual([
      'step 0 (POST /log): a log line holds "s3cret": ["received {\\"text\\":\\"s3cret\\"}"]',
    ]);
    expect(report.cases[2]?.failures).toEqual([
      'step 0 (GET /missing): no log line holds "received"; lines: []',
    ]);
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
      "CHK-074": { outcome: "refused", cases: ["a", "b"] },
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
    expect(report.checks).toEqual({
      "CHK-003": { outcome: "failed", cases: ["good", "bad"] },
      "CHK-074": { outcome: "failed", cases: ["good", "bad"] },
    });
  });

  test("a scoped case check counts only in the reports of the targets it names", async () => {
    const step = { request: { method: "GET", path: "/items" }, expect: { status: 200 } };
    const report = await run([
      suiteCase("scoped", {
        checks: [
          "CHK-003",
          { id: "CHK-004", targets: ["nestjs"] },
          { id: "CHK-005", targets: [TARGET] },
        ],
        steps: [step],
      }),
    ]);

    expect(report.cases[0]?.checks).toEqual(["CHK-003", "CHK-005"]);
    expect(Object.keys(report.checks)).toEqual(["CHK-003", "CHK-005", "CHK-074"]);
  });

  test("a case scoped to other targets is refused without a request, and runs on its own", async () => {
    const step = { request: { method: "GET", path: "/items" }, expect: { status: 200 } };
    const report = await run([
      suiteCase("elsewhere", { targets: ["express", "adonis"], steps: [step] }),
      suiteCase("here", { targets: [TARGET], steps: [step] }),
    ]);

    expect(report.cases.map(({ id, outcome, reason }) => ({ id, outcome, reason }))).toEqual([
      {
        id: "elsewhere",
        outcome: "refused",
        reason: "the case applies only to express, adonis",
      },
      { id: "here", outcome: "passed", reason: undefined },
    ]);
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

  test("sends a compressed body with its content coding", async () => {
    const report = await run([
      suiteCase("compressed", {
        steps: [
          {
            request: { method: "POST", path: "/gunzip", body: { title: "x" }, compress: "gzip" },
            expect: { status: 200, body: { encoding: "gzip", text: '{"title":"x"}' } },
          },
        ],
      }),
    ]);

    expect(report.cases[0]?.failures).toEqual([]);
  });

  test("sends a forged Host header as written", async () => {
    const forged = suiteCase("forged-host", {
      steps: [
        {
          request: {
            method: "GET",
            path: "/host",
            headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
          },
          expect: {
            status: 200,
            headers: { link: { contains: ["<https://origin.example/"] } },
            body: { host: "attacker.example", forwardedHost: "attacker.example" },
          },
        },
      ],
    });

    const report = await run([forged]);

    expect(report.cases[0]?.failures).toEqual([]);
  });

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
