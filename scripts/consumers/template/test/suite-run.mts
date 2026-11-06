// What the http suite's profile tests share: the target the consumer was built for, the report file of a profile,
// the refusals of the cases a run holds, and the run of an HTTP profile against the server the overlay starts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FormatReader,
  loadSuiteCases,
  packProfileOf,
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
  DEVICE_TOKEN,
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

/** The file a pack consumer's harness writes, naming the pack its contract applies (`@seampact/pack-hal`). */
export const PACK_FILE = ".seampact-pack";

/** The directory where the harness copies the golden IRs of the contract with the pack applied. */
export const PACK_IR_DIRECTORY = "pack-ir";

// The apis every server consumer serves; a pack profile reads their IRs.
const SERVED_APIS = ["tasks", "tasksService"] as const;

const SUITE_CREDENTIALS = {
  userToken: USER_TOKEN,
  throttledUserToken: THROTTLED_USER_TOKEN,
  serviceJwt: SERVICE_JWT,
  stripeSecret: STRIPE_SECRET,
  throttleRetryAfterMs: THROTTLE_RETRY_AFTER_MS,
  foreignServiceJwt: FOREIGN_SERVICE_JWT,
  deviceToken: DEVICE_TOKEN,
};

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

  describeSuiteRun({ profile, cases, refusals: refusalsOf(cases) });
}

/**
 * Runs the profile of the pack the consumer's contract applies (ADR 0015 "Suite profiles"): the default cases read
 * through the pack's format and paging style, then the pack's own cases.
 */
export function describePackProfile(): void {
  const packageName = readFileSync(join(CONSUMER_ROOT, PACK_FILE), "utf8").trim();
  const [firstApi, ...otherApis] = SERVED_APIS.map((api) =>
    JSON.parse(readFileSync(join(CONSUMER_ROOT, PACK_IR_DIRECTORY, `${api}.ir.json`), "utf8")),
  );
  const pack = packProfileOf([firstApi, ...otherApis], packageName);

  describeSuiteRun({
    profile: pack.profile,
    cases: pack.cases,
    reader: pack.reader,
    refusals: { ...pack.refusals, ...refusalsOf(pack.cases) },
  });
}

interface SuiteRun {
  readonly profile: SuiteProfile;
  readonly cases: readonly SuiteCase[];
  readonly refusals: Readonly<Record<string, string>>;
  readonly reader?: FormatReader;
}

function describeSuiteRun({ profile, cases, refusals, reader }: SuiteRun): void {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    server = await startServer();
    report = await runSuite({
      baseUrl: server.baseUrl,
      target: SUITE_TARGET,
      profile,
      credentials: SUITE_CREDENTIALS,
      cases,
      refusals,
      ...(reader === undefined ? {} : { reader }),
    });
    writeSuiteReport(report, reportFileOf(profile));
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await server?.close();
  });

  describe(`http suite, ${profile} profile`, () => {
    sharedTestEachCase(cases, () => report, refusals, test);
  });
}
