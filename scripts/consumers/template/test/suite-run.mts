// What the http suite's profile tests share: the target the consumer was built for, the report file of a profile,
// the refusals of the cases a run holds, and the run of an HTTP profile against the server the overlay starts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadSuiteCases,
  runSuite,
  type SuiteCase,
  type SuiteProfile,
  type SuiteReport,
  refusalsOf as sharedRefusalsOf,
  reportFileOf as sharedReportFileOf,
  testEachCase as sharedTestEachCase,
  writeSuiteReport,
} from "@seampact/http-suite";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  FOREIGN_SERVICE_JWT,
  SERVICE_JWT,
  STRIPE_SECRET,
  THROTTLE_RETRY_AFTER_MS,
  THROTTLED_USER_TOKEN,
  USER_TOKEN,
} from "./credentials.mjs";
import { startServer } from "./server.mjs";
import { SUITE_REFUSALS } from "./suite-refusals.mjs";

export const CONSUMER_ROOT = join(import.meta.dirname, "..");

/** The server target the consumer was assembled for, which the harness writes beside its commit. */
export const SUITE_TARGET = readFileSync(join(CONSUMER_ROOT, ".seampact-target"), "utf8").trim();

/** The profiles every server target runs (ADR 0015 "Suite profiles"). */
export const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];

// The whole suite runs once before the per-case tests read its report.
const SUITE_TIMEOUT_MS = 180_000;

export function reportFileOf(profile: SuiteProfile): string {
  return sharedReportFileOf(join(CONSUMER_ROOT, "reports"), profile);
}

/** The refusals of the cases a run holds; a refusal no profile's case takes fails the default profile's test. */
export function refusalsOf(cases: readonly SuiteCase[]): Record<string, string> {
  return sharedRefusalsOf(cases, SUITE_REFUSALS);
}

/** One test per case of the report: passed, or refused by name for a known target bug. */
export function testEachCase(
  cases: readonly SuiteCase[],
  report: () => SuiteReport | undefined,
): void {
  sharedTestEachCase(cases, report, SUITE_REFUSALS, test);
}

/** Runs an HTTP profile of the suite against the server the overlay starts and writes its report. */
export function describeHttpProfile(profile: SuiteProfile): void {
  const cases = loadSuiteCases(profile);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    server = await startServer();
    report = await runSuite({
      baseUrl: server.baseUrl,
      target: SUITE_TARGET,
      profile,
      credentials: {
        userToken: USER_TOKEN,
        throttledUserToken: THROTTLED_USER_TOKEN,
        serviceJwt: SERVICE_JWT,
        stripeSecret: STRIPE_SECRET,
        throttleRetryAfterMs: THROTTLE_RETRY_AFTER_MS,
        foreignServiceJwt: FOREIGN_SERVICE_JWT,
      },
      cases,
      refusals: refusalsOf(cases),
    });
    writeSuiteReport(report, reportFileOf(profile));
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await server?.close();
  });

  describe(`http suite, ${profile} profile`, () => {
    testEachCase(cases, () => report);
  });
}
