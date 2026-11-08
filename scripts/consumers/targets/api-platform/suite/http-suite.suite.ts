// Runs the shared http suite's `default` profile against the assembled API Platform consumer (ADR 0015 "Suite
// profiles") served by PHP's built-in server, and writes its report. The app directory and the report directory come
// from the environment: SEAMPACT_API_PLATFORM_APP and SEAMPACT_API_PLATFORM_REPORTS.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  loadSuiteCases,
  refusalsOf,
  reportFileOf,
  runSuite,
  type SuiteCredentials,
  type SuiteProfile,
  type SuiteReport,
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { type RunningApp, startApiPlatformApp } from "./api-platform-app.ts";
import { API_PLATFORM_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "api-platform";
const PROFILE: SuiteProfile = "default";
const SUITE_TIMEOUT_MS = 600_000;

const app = requiredEnvironment("SEAMPACT_API_PLATFORM_APP");
const reportDirectory = requiredEnvironment("SEAMPACT_API_PLATFORM_REPORTS");

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
    deviceToken: shared.deviceToken,
  };
}

describe(`http suite, ${PROFILE} profile`, () => {
  const cases = loadSuiteCases(PROFILE);
  let running: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    running = await startApiPlatformApp(app);
    report = await runSuite({
      baseUrl: running.baseUrl,
      target: TARGET,
      profile: PROFILE,
      credentials: readCredentials(),
      cases,
      refusals: refusalsOf(cases, API_PLATFORM_SUITE_REFUSALS),
    });
    writeSuiteReport(report, reportFileOf(reportDirectory, PROFILE));
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  testEachCase(cases, () => report, API_PLATFORM_SUITE_REFUSALS, test);
});
