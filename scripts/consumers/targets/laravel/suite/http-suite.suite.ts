// Runs the shared http suite's `default`, `hand-written`, `boot` and `pack:laravel` profiles against the assembled
// Laravel consumer (ADR 0015 "Suite profiles") served by PHP's built-in server, and writes one report per profile. The
// app directories and the report directory come from the environment: SEAMPACT_LARAVEL_APP,
// SEAMPACT_LARAVEL_ALLOW_LISTED_APP, SEAMPACT_LARAVEL_PACK_APP and SEAMPACT_LARAVEL_REPORTS.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ContractIR } from "../../../../../packages/core/spec/src/ir/index.ts";
import {
  loadSuiteCases,
  packProfileOf,
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
import { type RunningApp, startLaravelApp } from "./laravel-app.ts";
import { LARAVEL_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "laravel";
const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the app built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = [
  "default",
  "hand-written",
  "boot",
  "pack:laravel",
];
const BOOT_ROUTES_CACHE = "boot-routes.php";
const LARAVEL_PACK = "@seampact/pack-laravel";
const PACK_LARAVEL_GOLDEN = join(
  import.meta.dirname,
  "../../../../../fixtures/golden/pack-laravel",
);

const app = requiredEnvironment("SEAMPACT_LARAVEL_APP");
const allowListedApp = requiredEnvironment("SEAMPACT_LARAVEL_ALLOW_LISTED_APP");
const packApp = requiredEnvironment("SEAMPACT_LARAVEL_PACK_APP");
const reportDirectory = requiredEnvironment("SEAMPACT_LARAVEL_REPORTS");
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
      running = await startLaravelApp(app);
      report = await runSuite({
        baseUrl: running.baseUrl,
        target: TARGET,
        profile,
        credentials,
        cases,
        refusals: refusalsOf(cases, LARAVEL_SUITE_REFUSALS),
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    testEachCase(cases, () => report, LARAVEL_SUITE_REFUSALS, test);
  });
}

// A boot is `route:cache`, which boots a fresh app and runs the boot check as an HTTP boot without a route cache
// does; its cache goes to a file of its own, so the served app keeps its cache.
function bootRun(
  cases: readonly SuiteCase[],
  appDirectory: string,
  refusals: Record<string, string>,
) {
  return runBootSuite({
    target: TARGET,
    cases,
    refusals,
    command: "sh",
    args: [
      "-c",
      'APP_ROUTES_CACHE="$1" php artisan route:cache && echo "seampact-suite: started"',
      "sh",
      join(reportDirectory, BOOT_ROUTES_CACHE),
    ],
    cwd: appDirectory,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
}

// The allow-listed variant needs the route in the config, so it boots the second app; the other cases boot the first.
async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  const refusals = refusalsOf(cases, LARAVEL_SUITE_REFUSALS);
  const onMainApp = await bootRun(cases, app, {
    ...refusals,
    [ALLOW_LISTED_CASE]: ALLOW_LISTED_ELSEWHERE,
  });
  const allowListedCases = cases.filter((suiteCase) => suiteCase.id === ALLOW_LISTED_CASE);
  const onAllowListedApp = await bootRun(
    allowListedCases,
    allowListedApp,
    refusalsOf(allowListedCases, LARAVEL_SUITE_REFUSALS),
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
// The token the user hook double answers with Laravel's AuthorizationException (UserHook::GATE_DENIED_TOKEN).
const GATE_DENIED_TOKEN = "seampact-gate-denied";
// The token it answers with Laravel's AuthenticationException (UserHook::GUARD_DENIED_TOKEN).
const GUARD_DENIED_TOKEN = "seampact-guard-denied";

async function problemCode(response: Response): Promise<unknown> {
  const body: unknown = await response.json();

  return typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
}

// What the shared cases do not reach: a CORS preflight, the order of the body limit and the media type, and the
// boundary's own failures under `responses: warn`.
describe("boundary edges of the Laravel runtime", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(app);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  test("Laravel's dump() of a credential prints it redacted", async () => {
    const response = await fetch(`${running?.baseUrl}/__seampact/dumped-credential`);
    const dumped = await response.text();

    expect(response.status).toBe(200);
    expect(dumped).toContain("[redacted]");
    expect(dumped).not.toContain(credentials.userToken);
  });

  test("a CORS preflight on a contract path is left to HandleCors", async () => {
    const response = await fetch(`${running?.baseUrl}/v1/health`, {
      method: "OPTIONS",
      headers: { origin: "https://front.example", "access-control-request-method": "GET" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a body above the limit answers 413 whatever its media type", async () => {
    const response = await fetch(`${running?.baseUrl}${GENERAL_CHANNEL}/tasks/batch`, {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.userToken}`, "content-type": "text/plain" },
      body: "x".repeat(ABOVE_BATCH_LIMIT_BYTES),
    });

    expect(response.status).toBe(413);
  });
});

describe("an AuthorizationException in an authenticate hook", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(app);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  // The core operations declare no 403, so the reply is the api's 500 either way; the log names the role it kept.
  test("keeps the forbidden role", async () => {
    await fetch(`${running?.baseUrl}/__seampact/script`, { method: "PUT", body: "{}" });
    await fetch(`${running?.baseUrl}${TASK_PATH}`, {
      headers: { authorization: `Bearer ${GATE_DENIED_TOKEN}` },
    });

    const logged = await fetch(`${running?.baseUrl}/__seampact/log-lines`);
    const { lines } = (await logged.json()) as { lines: string[] };

    expect(lines.some((line) => line.includes("the role 'forbidden'"))).toBe(true);
  });
});

describe("an AuthenticationException in an authenticate hook", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(app);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  for (const accept of ["application/json", "text/html"]) {
    test(`answers the unauthenticated role to Accept: ${accept}`, async () => {
      const response = await fetch(`${running?.baseUrl}${TASK_PATH}`, {
        headers: { authorization: `Bearer ${GUARD_DENIED_TOKEN}`, accept },
        redirect: "manual",
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
      expect(await problemCode(response)).toBe("api.unauthenticated");
    });
  }
});

describe("a missing hook under responses: warn", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(app, {
      SEAMPACT_SUITE_BOOT_VARIANT: "missing-authenticate-hook",
      SEAMPACT_SUITE_RESPONSES: "warn",
    });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  test("answers the api's 500, never the framework's error page", async () => {
    const response = await fetch(`${running?.baseUrl}${TASK_PATH}`, {
      headers: { authorization: `Bearer ${credentials.userToken}` },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
    expect(await problemCode(response)).toBe("api.internal");
  });
});

describe("a handler exception under responses: warn with APP_DEBUG on", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(app, {
      SEAMPACT_SUITE_RESPONSES: "warn",
      SEAMPACT_SUITE_APP_DEBUG: "true",
    });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  test("answers the api's 500, never the framework's error page or trace", async () => {
    const script = await fetch(`${running?.baseUrl}/__seampact/script`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: { "tasks.getChannel": { throws: "the channel store is down" } },
      }),
    });

    expect(script.status).toBe(204);

    const response = await fetch(`${running?.baseUrl}${GENERAL_CHANNEL}`, {
      headers: { authorization: `Bearer ${credentials.userToken}` },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON);
    expect(await problemCode(response)).toBe("api.internal");
  });
});

describeHttpProfile("default");
describeHttpProfile("hand-written");

function packLaravelIr(contract: string): ContractIR {
  return JSON.parse(readFileSync(join(PACK_LARAVEL_GOLDEN, `${contract}.ir.json`), "utf8"));
}

// The pack-laravel app serves the reference contract with `@seampact/pack-laravel` applied, its paged lists answering
// Laravel's paginators; its profile reads the default cases through the pack's format and paging style, then runs the
// pack's own cases.
describe("http suite, pack:laravel profile", () => {
  const pack = packProfileOf([packLaravelIr("tasks"), packLaravelIr("tasksService")], LARAVEL_PACK);
  const refusals = {
    ...pack.refusals,
    ...refusalsOf(pack.cases, LARAVEL_SUITE_REFUSALS),
  };
  let running: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    running = await startLaravelApp(packApp);
    report = await runSuite({
      baseUrl: running.baseUrl,
      target: TARGET,
      profile: pack.profile,
      credentials,
      cases: pack.cases,
      reader: pack.reader,
      refusals,
    });
    writeSuiteReport(report, reportFileOf(reportDirectory, pack.profile));
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  testEachCase(pack.cases, () => report, refusals, test);

  // pack-laravel-page-next-link, with its query-only next link resolved against the URL of the page it came from.
  test("a page's next link, resolved against the page's URL, fetches the next page", async () => {
    const authorization = { authorization: `Bearer ${credentials.userToken}` };
    const firstUrl = `${running?.baseUrl}${GENERAL_CHANNEL}/tasks?per_page=2&page=1`;
    const first = await fetch(firstUrl, { headers: authorization });
    const firstPage = (await first.json()) as {
      links: { next: string };
      meta: { current_page: number };
    };

    expect(firstPage.meta.current_page).toBe(1);

    const second = await fetch(new URL(firstPage.links.next, firstUrl), { headers: authorization });
    const secondPage = (await second.json()) as {
      meta: { current_page: number; per_page: number };
    };

    expect(second.status).toBe(200);
    expect(secondPage.meta).toMatchObject({ current_page: 2, per_page: 2 });
  });
});

describe("http suite, boot profile", () => {
  const cases = loadSuiteCases("boot");
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    report = await runBootProfile(cases);
    writeSuiteReport(report, reportFileOf(reportDirectory, "boot"));
  }, SUITE_TIMEOUT_MS);

  testEachCase(cases, () => report, LARAVEL_SUITE_REFUSALS, test);
});

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(LARAVEL_SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
