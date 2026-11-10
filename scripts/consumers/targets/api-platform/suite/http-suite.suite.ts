// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled API Platform
// consumer (ADR 0015 "Suite profiles") served by PHP's built-in server, and writes one report per profile. The app
// directories and the report directory come from the environment: SEAMPACT_API_PLATFORM_APP,
// SEAMPACT_API_PLATFORM_ALLOW_LISTED_APP, SEAMPACT_API_PLATFORM_ROUTE_CHECK_OFF_APP,
// SEAMPACT_API_PLATFORM_HOOK_CHECK_OFF_APP and SEAMPACT_API_PLATFORM_REPORTS.
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
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { type ConsumerBootApp, runBootProfileOnApps } from "../../../boot-apps.ts";
import { type RunningApp, requiredEnvironment, startApiPlatformApp } from "./api-platform-app.ts";
import { API_PLATFORM_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "api-platform";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];

const app = requiredEnvironment("SEAMPACT_API_PLATFORM_APP");
const bootAppDirectoryOf: Readonly<Record<ConsumerBootApp, string>> = {
  main: app,
  "allow-listed": requiredEnvironment("SEAMPACT_API_PLATFORM_ALLOW_LISTED_APP"),
  "route-check-off": requiredEnvironment("SEAMPACT_API_PLATFORM_ROUTE_CHECK_OFF_APP"),
  "hook-check-off": requiredEnvironment("SEAMPACT_API_PLATFORM_HOOK_CHECK_OFF_APP"),
};
const reportDirectory = requiredEnvironment("SEAMPACT_API_PLATFORM_REPORTS");

mkdirSync(reportDirectory, { recursive: true });

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
    deviceToken: shared.deviceToken,
  };
}

function describeHttpProfile(profile: SuiteProfile): void {
  describe(`http suite, ${profile} profile`, () => {
    const cases = loadSuiteCases(profile);
    let running: RunningApp | undefined;
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      running = await startApiPlatformApp(app);
      report = await runSuite({
        baseUrl: running.baseUrl,
        target: TARGET,
        profile,
        credentials: readCredentials(),
        cases,
        refusals: refusalsOf(cases, API_PLATFORM_SUITE_REFUSALS),
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    testEachCase(cases, () => report, API_PLATFORM_SUITE_REFUSALS, test);
  });
}

// A boot is `cache:warmup` into a cache directory of its own, which builds the container (the boot check's compiler
// pass) and loads the routes (its route check), as a deploy's warm-up does.
const bootCacheRoot = mkdtempSync(join(tmpdir(), "seampact-api-platform-boot-"));
let bootRuns = 0;

function bootRun(
  cases: readonly SuiteCase[],
  appDirectory: string,
  refusals: Readonly<Record<string, string>>,
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

describeHttpProfile("default");
describeHttpProfile("hand-written");

describe("http suite, boot profile", () => {
  const cases = loadSuiteCases("boot");
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    report = await runBootProfileOnApps(
      TARGET,
      cases,
      API_PLATFORM_SUITE_REFUSALS,
      (bootApp, appCases, refusals) => bootRun(appCases, bootAppDirectoryOf[bootApp], refusals),
    );
    writeSuiteReport(report, reportFileOf(reportDirectory, "boot"));
  }, SUITE_TIMEOUT_MS);

  testEachCase(cases, () => report, API_PLATFORM_SUITE_REFUSALS, test);
});

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(API_PLATFORM_SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
