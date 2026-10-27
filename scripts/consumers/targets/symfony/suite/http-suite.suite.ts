// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled Symfony consumer
// (ADR 0015 "Suite profiles") served by PHP's built-in server, and writes one report per profile. The app
// directories and the report directory come from the environment: SEAMPACT_SYMFONY_APP,
// SEAMPACT_SYMFONY_ALLOW_LISTED_APP and SEAMPACT_SYMFONY_REPORTS.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  loadSuiteCases,
  refusalsOf,
  reportFileOf,
  runBootSuite,
  runSuite,
  type SuiteCase,
  type SuiteCredentials,
  type SuiteProfile,
  type SuiteReport,
  suiteReportOf,
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { SYMFONY_SUITE_REFUSALS } from "./suite-refusals.ts";
import { type RunningApp, startSymfonyApp } from "./symfony-app.ts";

const TARGET = "symfony";
const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the app built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];

const app = requiredEnvironment("SEAMPACT_SYMFONY_APP");
const allowListedApp = requiredEnvironment("SEAMPACT_SYMFONY_ALLOW_LISTED_APP");
const reportDirectory = requiredEnvironment("SEAMPACT_SYMFONY_REPORTS");
const credentials = readCredentials();

mkdirSync(reportDirectory, { recursive: true });

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `Set ${name}: the http suite runs against the assembled consumer (see the README).`,
    );
  }

  return value;
}

function readCredentials(): SuiteCredentials {
  const shared = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../spring-boot/credentials.json"), "utf8"),
  );

  return {
    userToken: shared.userToken,
    throttledUserToken: shared.throttledUserToken,
    serviceJwt: shared.serviceJwt,
    stripeSecret: shared.stripeSecret,
    throttleRetryAfterMs: shared.throttleRetryAfterMs,
    foreignServiceJwt: shared.foreignServiceJwt,
  };
}

function describeHttpProfile(profile: SuiteProfile): void {
  describe(`http suite, ${profile} profile`, () => {
    const cases = loadSuiteCases(profile);
    let running: RunningApp | undefined;
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      running = await startSymfonyApp(app);
      report = await runSuite({
        baseUrl: running.baseUrl,
        target: TARGET,
        profile,
        credentials,
        cases,
        refusals: refusalsOf(cases, SYMFONY_SUITE_REFUSALS),
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    testEachCase(cases, () => report, SYMFONY_SUITE_REFUSALS, test);
  });
}

// A boot is `cache:warmup` into a cache directory of its own, which builds the container (the boot check's compiler
// pass), loads the routes (its route check) and runs the hook check's warmer, as a deploy's warm-up does.
const bootCacheRoot = mkdtempSync(join(tmpdir(), "seampact-symfony-boot-"));
let bootRuns = 0;

function bootRun(
  cases: readonly SuiteCase[],
  appDirectory: string,
  refusals: Record<string, string>,
) {
  bootRuns += 1;

  return runBootSuite({
    target: TARGET,
    cases,
    refusals,
    command: "sh",
    args: [
      "-c",
      'SEAMPACT_SUITE_CACHE_DIR="$1/$$" php bin/console cache:warmup && echo "seampact-suite: started"',
      "sh",
      join(bootCacheRoot, `${bootRuns}`),
    ],
    cwd: appDirectory,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
}

// The allow-listed variant needs the route in the config, so it boots the second app; the other cases boot the first.
async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  const refusals = refusalsOf(cases, SYMFONY_SUITE_REFUSALS);
  const onMainApp = await bootRun(cases, app, {
    ...refusals,
    [ALLOW_LISTED_CASE]: ALLOW_LISTED_ELSEWHERE,
  });
  const allowListedCases = cases.filter((suiteCase) => suiteCase.id === ALLOW_LISTED_CASE);
  const onAllowListedApp = await bootRun(
    allowListedCases,
    allowListedApp,
    refusalsOf(allowListedCases, SYMFONY_SUITE_REFUSALS),
  );
  const merged = onMainApp.cases.map(
    (result) => onAllowListedApp.cases.find((other) => other.id === result.id) ?? result,
  );

  return suiteReportOf({ target: TARGET, profile: "boot" }, merged);
}

const GENERAL_CHANNEL = "/v1/channels/10000000-0000-4000-8000-000000000001";
const TASK_PATH = `${GENERAL_CHANNEL}/tasks/20000000-0000-4000-8000-000000000001`;
const PROBLEM_JSON = "application/problem+json";
const ABOVE_BATCH_LIMIT_BYTES = 3_000_000;
// The token the user hook double answers with Symfony's AccessDeniedException (UserHook::GATE_DENIED_TOKEN).
const GATE_DENIED_TOKEN = "seampact-gate-denied";
// The token it answers with Symfony's AuthenticationException (UserHook::GUARD_DENIED_TOKEN).
const GUARD_DENIED_TOKEN = "seampact-guard-denied";
// The in-memory user of the app's `http_basic` firewall (Kernel::SUITE_USER and SUITE_PASSWORD).
const SUITE_USER_BASIC = `Basic ${Buffer.from("suite-user:suite-password").toString("base64")}`;
const WRONG_PASSWORD_BASIC = `Basic ${Buffer.from("suite-user:wrong").toString("base64")}`;
// A user name of its own per run, so only this row spends its `login_throttling` attempts (Kernel::LOGIN_ATTEMPTS).
const THROTTLED_LOGIN_BASIC = `Basic ${Buffer.from(`throttled-login-${Date.now()}:wrong`).toString("base64")}`;
const LOGIN_ATTEMPTS = 3;
// The header the app's `access_control` rule matches (ForbiddenProbeMatcher::HEADER).
const FORBIDDEN_PROBE_HEADER = "x-seampact-suite-forbidden";
const UNDECLARED_STATUS = 418;
// The header on which the app's response listener rewrites the reply (MutatingResponseListener::HEADER).
const MUTATE_HEADER = "x-seampact-suite-mutate";
// The channel whose scope resolver throws AccessDeniedException (ChannelResolver::ACCESS_DENIED_CHANNEL).
const ACCESS_DENIED_CHANNEL = "/v1/channels/10000000-0000-4000-8000-0000000000ad";
// The session token the user hook answers with the firewall's user from the token storage (UserHook::FIREWALL_USER_TOKEN).
const FIREWALL_USER_COOKIE = "__Host-session=seampact-firewall-user";
// The header of the access_control rule on the generated identity matcher (Kernel::IDENTITY_PROBE_HEADER).
const IDENTITY_PROBE_HEADER = "x-seampact-suite-identity-probe";
// The header on which the app's listener throws an HttpException on identity routes (NativeLayersListener::HEADER).
const NATIVE_LAYER_HEADER = "x-suite-native-layer";
// The header naming the right the app's voter denies (SuiteVoter::DENY_HEADER).
const VOTER_DENY_HEADER = "x-suite-voter-deny";

async function problemCode(response: Response): Promise<unknown> {
  const body: unknown = await response.json();

  return typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
}

async function logLines(running: RunningApp | undefined): Promise<string[]> {
  const logged = await fetch(`${running?.baseUrl}/__seampact/log-lines`);
  const { lines } = (await logged.json()) as { lines: string[] };

  return lines;
}

async function loadScript(running: RunningApp | undefined, script: object): Promise<void> {
  const loaded = await fetch(`${running?.baseUrl}/__seampact/script`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(script),
  });

  expect(loaded.status).toBe(204);
}

/** Serves the app with [env] for the tests [define] registers, stopped after them. */
function describeServed(
  title: string,
  env: Readonly<Record<string, string>>,
  define: (app: () => RunningApp | undefined) => void,
): void {
  describe(title, () => {
    let running: RunningApp | undefined;

    beforeAll(async () => {
      running = await startSymfonyApp(app, env);
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    define(() => running);
  });
}

// What the shared cases do not reach: a CORS preflight, the order of the body limit and the media type, the
// firewall's refusals, and the boundary's own failures under `responses: warn`.
describeServed("boundary edges of the Symfony runtime", {}, (running) => {
  test("a CORS preflight on a contract path is left to the app's CORS layer", async () => {
    const response = await fetch(`${running()?.baseUrl}/v1/health`, {
      method: "OPTIONS",
      headers: { origin: "https://front.example", "access-control-request-method": "GET" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a body above the limit answers 413 whatever its media type", async () => {
    const response = await fetch(`${running()?.baseUrl}${GENERAL_CHANNEL}/tasks/batch`, {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.userToken}`, "content-type": "text/plain" },
      body: "x".repeat(ABOVE_BATCH_LIMIT_BYTES),
    });

    expect(response.status).toBe(413);
  });

  test("http_basic with a wrong password answers the unauthenticated role through LoginFailureEvent", async () => {
    const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
      headers: { authorization: WRONG_PASSWORD_BASIC, accept: "application/json" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
    expect(await problemCode(response)).toBe("api.unauthenticated");
  });

  // The core operations declare no 403, so the reply is the api's 500; the log names the role it kept.
  test("an access_control denial keeps the forbidden role", async () => {
    await loadScript(running(), {});
    const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
      headers: { authorization: SUITE_USER_BASIC, [FORBIDDEN_PROBE_HEADER]: "1" },
    });

    expect(response.status).toBe(500);
    expect(await problemCode(response)).toBe("api.internal");
    expect((await logLines(running())).some((line) => line.includes("the role 'forbidden'"))).toBe(
      true,
    );
  });

  // No operation declares the rateLimited role, so the reply is the api's 500; the log names the role it kept.
  test("login_throttling keeps the rateLimited role once a user name spent its attempts", async () => {
    await loadScript(running(), {});
    const statuses: number[] = [];

    for (let attempt = 0; attempt <= LOGIN_ATTEMPTS; attempt++) {
      const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
        headers: { authorization: THROTTLED_LOGIN_BASIC, accept: "application/json" },
      });

      statuses.push(response.status);
      await response.body?.cancel();
    }

    expect(statuses).toEqual([...Array(LOGIN_ATTEMPTS).fill(401), 500]);
    expect(
      (await logLines(running())).some((line) => line.includes("the role 'rateLimited'")),
    ).toBe(true);
  });

  // The caller is anonymous to the firewall, whose listener answers the denial with its entry point (ADR 0024).
  test("an AccessDeniedException in an authenticate hook answers the unauthenticated role", async () => {
    const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
      headers: { authorization: `Bearer ${GATE_DENIED_TOKEN}` },
    });

    expect(response.status).toBe(401);
    expect(await problemCode(response)).toBe("api.unauthenticated");
  });

  // Symfony's router matches the decoded path, so the router's 404 comes after step 1 matched the raw path.
  test("an encoded slash in a path segment answers the path's 404", async () => {
    const response = await fetch(`${running()?.baseUrl}/v1/channels/a%2Fb`, {
      headers: { authorization: `Bearer ${credentials.userToken}` },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
    expect(await problemCode(response)).toBe("api.not_found");
  });

  test("an app's response listener cannot rewrite the boundary's own reply unchecked", async () => {
    const response = await fetch(`${running()?.baseUrl}/v1/no-such-operation`, {
      headers: { [MUTATE_HEADER]: "1" },
    });

    expect(response.status).toBe(500);
    expect(await problemCode(response)).toBe("api.internal");
  });

  test("an app's response listener cannot replace the boundary's own reply unchecked", async () => {
    const response = await fetch(`${running()?.baseUrl}/v1/no-such-operation`, {
      headers: { [MUTATE_HEADER]: "replace" },
    });

    expect(response.status).toBe(500);
    expect(await problemCode(response)).toBe("api.internal");
  });

  // The core operations declare no 403, so the reply is the api's 500; the log names the role it kept.
  test("an AccessDeniedException from a scope resolver after the hook admitted the caller keeps the forbidden role", async () => {
    await loadScript(running(), {});
    const response = await fetch(`${running()?.baseUrl}${ACCESS_DENIED_CHANNEL}`, {
      headers: { authorization: `Bearer ${credentials.userToken}` },
    });

    expect(response.status).toBe(500);
    expect((await logLines(running())).some((line) => line.includes("the role 'forbidden'"))).toBe(
      true,
    );
  });

  for (const accept of ["application/json", "text/html"]) {
    test(`an AuthenticationException in an authenticate hook answers the unauthenticated role to Accept: ${accept}`, async () => {
      const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
        headers: { authorization: `Bearer ${GUARD_DENIED_TOKEN}`, accept },
        redirect: "manual",
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
      expect(await problemCode(response)).toBe("api.unauthenticated");
    });
  }
});

// Symfony's own layers beside the boundary: the firewall's user read by the authenticate hook, the app's voters asked
// by a decider, an access_control rule and an app listener on the generated identity request matcher.
describeServed("Symfony's native layers on identity routes", {}, (running) => {
  function signedIn(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${running()?.baseUrl}${path}`, {
      headers: { authorization: SUITE_USER_BASIC, cookie: FIREWALL_USER_COOKIE, ...headers },
    });
  }

  function withBearer(path: string, headers: Record<string, string>): Promise<Response> {
    return fetch(`${running()?.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${credentials.userToken}`, ...headers },
    });
  }

  async function loggedRole(role: string): Promise<boolean> {
    return (await logLines(running())).some((line) => line.includes(`the role '${role}'`));
  }

  test("an authenticate hook reads the user the firewall authenticated from the token storage", async () => {
    await loadScript(running(), {});
    const response = await signedIn(TASK_PATH);

    expect(response.status).toBe(200);
  });

  test("without a firewall user the token storage hook answers the unauthenticated role", async () => {
    const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
      headers: { cookie: FIREWALL_USER_COOKIE },
    });

    expect(response.status).toBe(401);
    expect(await problemCode(response)).toBe("api.unauthenticated");
  });

  test("a right the app's voter denies through isGranted answers the right's first denial code", async () => {
    await loadScript(running(), {});
    const response = await fetch(`${running()?.baseUrl}${GENERAL_CHANNEL}/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.userToken}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        [VOTER_DENY_HEADER]: "roles",
      },
      body: JSON.stringify({ title: "Denied by a voter" }),
    });

    expect(response.status).toBe(403);
    expect(await problemCode(response)).toBe("api.forbidden");
  });

  // getTask declares no 403, so the reply is the api's 500; the log names the role it kept.
  test("an access_control rule on the identity request matcher keeps the forbidden role", async () => {
    await loadScript(running(), {});
    const response = await signedIn(TASK_PATH, { [IDENTITY_PROBE_HEADER]: "1" });

    expect(response.status).toBe(500);
    expect(await loggedRole("forbidden")).toBe(true);
  });

  test("the identity request matcher does not match a public route", async () => {
    const response = await signedIn("/v1/health", { [IDENTITY_PROBE_HEADER]: "1" });

    expect(response.status).toBe(200);
  });

  test("an HttpException 401 from an app listener answers the unauthenticated role", async () => {
    const response = await withBearer(TASK_PATH, { [NATIVE_LAYER_HEADER]: "abort-401" });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
    expect(await problemCode(response)).toBe("api.unauthenticated");
  });

  // getTask declares neither 403 nor 429, so the replies are the api's 500; the log names the roles they kept.
  test("an HttpException 403 or 429 from an app listener takes the forbidden or rateLimited role", async () => {
    await loadScript(running(), {});
    const forbidden = await withBearer(TASK_PATH, { [NATIVE_LAYER_HEADER]: "abort-403" });
    const rateLimited = await withBearer(TASK_PATH, { [NATIVE_LAYER_HEADER]: "abort-429" });

    expect([forbidden.status, rateLimited.status]).toEqual([500, 500]);
    expect(await loggedRole("forbidden")).toBe(true);
    expect(await loggedRole("rateLimited")).toBe(true);
  });

  function createTaskThrough(layer: string): Promise<Response> {
    return fetch(`${running()?.baseUrl}${GENERAL_CHANNEL}/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.userToken}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        [NATIVE_LAYER_HEADER]: layer,
      },
      body: JSON.stringify({ title: "Throttled" }),
    });
  }

  // createTask declares api.rate_limited, whose required retryAfterMs only a Retry-After header gives.
  test("a TooManyRequestsHttpException answers the rate-limited code with the delay of its Retry-After", async () => {
    await loadScript(running(), {});
    const inSeconds = await createTaskThrough("throttle-30");
    const atDate = await createTaskThrough("throttle-date");
    const atDateBody = (await atDate.json()) as { retryAfterMs?: number };

    expect([inSeconds.status, atDate.status]).toEqual([429, 429]);
    expect(inSeconds.headers.get("retry-after")).toBe("30");
    expect(await inSeconds.json()).toMatchObject({
      code: "api.rate_limited",
      retryAfterMs: 30_000,
    });
    expect(atDateBody.retryAfterMs).toBeGreaterThanOrEqual(58_000);
    expect(atDateBody.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  test("an HttpException 429 without a Retry-After answers the api's 500 on a rate-limited code with required params", async () => {
    await loadScript(running(), {});
    const response = await createTaskThrough("abort-429");

    expect(response.status).toBe(500);
  });

  test("the app listener on the identity request matcher leaves a public route alone", async () => {
    const response = await withBearer("/v1/health", { [NATIVE_LAYER_HEADER]: "abort-403" });

    expect(response.status).toBe(200);
  });
});

describeServed(
  "a missing hook under responses: warn",
  { SEAMPACT_SUITE_BOOT_VARIANT: "missing-authenticate-hook", SEAMPACT_SUITE_RESPONSES: "warn" },
  (running) => {
    test("answers the api's 500, never the framework's error page", async () => {
      const response = await fetch(`${running()?.baseUrl}${TASK_PATH}`, {
        headers: { authorization: `Bearer ${credentials.userToken}` },
      });

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
      expect(await problemCode(response)).toBe("api.internal");
    });
  },
);

describeServed(
  "a handler exception under responses: warn with the kernel in debug",
  { SEAMPACT_SUITE_RESPONSES: "warn", SEAMPACT_SUITE_APP_DEBUG: "true" },
  (running) => {
    test("shows Symfony's error page with the exception, as debug mode does off a contract route", async () => {
      await loadScript(running(), {
        answers: { "tasks.getChannel": { throws: "the channel store is down" } },
      });
      const response = await fetch(`${running()?.baseUrl}${GENERAL_CHANNEL}`, {
        headers: { authorization: `Bearer ${credentials.userToken}` },
      });

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).not.toContain(PROBLEM_JSON);
      expect(await response.text()).toContain("the channel store is down");
    });

    // The app's listener at the default priority runs before the boundary's unmapped-exception listener.
    test("an app's exception listener writes its own reply, which the outgoing check judges", async () => {
      await loadScript(running(), {
        answers: { "tasks.getChannel": { status: UNDECLARED_STATUS, body: { note: "app reply" } } },
      });
      const response = await fetch(`${running()?.baseUrl}${GENERAL_CHANNEL}`, {
        headers: { authorization: `Bearer ${credentials.userToken}` },
      });

      expect(response.status).toBe(UNDECLARED_STATUS);
      expect(await response.json()).toEqual({ note: "app reply" });
    });
  },
);

describeHttpProfile("default");
describeHttpProfile("hand-written");

describe("http suite, boot profile", () => {
  const cases = loadSuiteCases("boot");
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    report = await runBootProfile(cases);
    writeSuiteReport(report, reportFileOf(reportDirectory, "boot"));
  }, SUITE_TIMEOUT_MS);

  testEachCase(cases, () => report, SYMFONY_SUITE_REFUSALS, test);
});

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(SYMFONY_SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
