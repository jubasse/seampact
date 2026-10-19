// Runs the default profile of the shared HTTP suite against the server the overlay starts, writes its report to
// `reports/`, and passes one test per case: passed, or refused by name for a known target bug.
import { join } from "node:path";
import { loadSuiteCases, runSuite, type SuiteReport, writeSuiteReport } from "@seampact/http-suite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

const PROFILE = "default";
const REPORT_FILE = join(import.meta.dirname, "..", "reports", `http-suite-${PROFILE}.json`);
// The whole suite runs once before the per-case tests read its report.
const SUITE_TIMEOUT_MS = 120_000;

const cases = loadSuiteCases(PROFILE);
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let report: SuiteReport | undefined;

beforeAll(async () => {
  server = await startServer();
  report = await runSuite({
    baseUrl: server.baseUrl,
    profile: PROFILE,
    credentials: {
      userToken: USER_TOKEN,
      throttledUserToken: THROTTLED_USER_TOKEN,
      serviceJwt: SERVICE_JWT,
      stripeSecret: STRIPE_SECRET,
      throttleRetryAfterMs: THROTTLE_RETRY_AFTER_MS,
      foreignServiceJwt: FOREIGN_SERVICE_JWT,
    },
    cases,
    refusals: SUITE_REFUSALS,
  });
  writeSuiteReport(report, REPORT_FILE);
}, SUITE_TIMEOUT_MS);

afterAll(async () => {
  await server?.close();
});

describe(`http suite, ${PROFILE} profile`, () => {
  test.each(cases.map((suiteCase) => [suiteCase.id, suiteCase.title]))("%s: %s", (id) => {
    const result = report?.cases.find((caseResult) => caseResult.id === id);

    expect(result?.failures).toEqual([]);
    expect(result?.outcome).toBe(Object.hasOwn(SUITE_REFUSALS, id) ? "refused" : "passed");
  });
});
