// Runs the shared http suite's `pack:api-platform` profile against the API Platform consumer built over the reference
// contract with `@seampact/pack-api-platform` applied (ADR 0015 "Suite profiles"), served by PHP's built-in server:
// the default cases read through the pack's JSON-LD format and Hydra paging, then the pack's own cases. The app
// directory and the report directory come from the environment: SEAMPACT_API_PLATFORM_PACK_APP and
// SEAMPACT_API_PLATFORM_REPORTS.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  refusalsOf,
  reportFileOf,
  runSuite,
  type SuiteCredentials,
  type SuiteReport,
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { goldenPackProfile } from "../../../golden-pack-profile.ts";
import { type RunningApp, requiredEnvironment, startApiPlatformApp } from "./api-platform-app.ts";
import { API_PLATFORM_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "api-platform";
const PACK = "pack-api-platform";
const SUITE_TIMEOUT_MS = 600_000;

const app = requiredEnvironment("SEAMPACT_API_PLATFORM_PACK_APP");
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

describe("http suite, pack:api-platform profile", () => {
  const pack = goldenPackProfile(PACK);
  const refusals = {
    ...pack.refusals,
    ...refusalsOf(pack.cases, API_PLATFORM_SUITE_REFUSALS),
  };
  let running: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    running = await startApiPlatformApp(app);
    report = await runSuite({
      baseUrl: running.baseUrl,
      target: TARGET,
      profile: pack.profile,
      credentials: readCredentials(),
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
});
