// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the Spring Boot consumer's
// jars (ADR 0015 "Suite profiles") and writes one report per profile. The jars and the report directory come from
// the environment: SEAMPACT_SPRING_JAR, SEAMPACT_SPRING_ALLOW_LISTED_JAR and SEAMPACT_SPRING_REPORTS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  loadSuiteCases,
  runBootSuite,
  runSuite,
  type SuiteCase,
  type SuiteCredentials,
  type SuiteProfile,
  type SuiteReport,
  suiteReportOf,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { type RunningApp, startSpringApp } from "./spring-app.ts";
import { SPRING_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "spring-boot";
const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the jar built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;

const jar = requiredEnvironment("SEAMPACT_SPRING_JAR");
const allowListedJar = requiredEnvironment("SEAMPACT_SPRING_ALLOW_LISTED_JAR");
const reportDirectory = requiredEnvironment("SEAMPACT_SPRING_REPORTS");
const credentials = readCredentials();

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `Set ${name}: the http suite runs against the consumer's built jars (see the README).`,
    );
  }

  return value;
}

function readCredentials(): SuiteCredentials {
  const shared = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "credentials.json"), "utf8"),
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

function refusalsOf(cases: readonly SuiteCase[]): Record<string, string> {
  return Object.fromEntries(
    cases.flatMap((suiteCase) => {
      const reason = SPRING_SUITE_REFUSALS[suiteCase.id];

      return reason === undefined ? [] : [[suiteCase.id, reason]];
    }),
  );
}

function reportFileOf(profile: SuiteProfile): string {
  return join(reportDirectory, `http-suite-${profile}.json`);
}

function testEachCase(cases: readonly SuiteCase[], report: () => SuiteReport | undefined): void {
  test.each(cases.map((suiteCase) => [suiteCase.id, suiteCase.title]))("%s: %s", (id) => {
    const result = report()?.cases.find((caseResult) => caseResult.id === id);

    expect(result?.failures).toEqual([]);
    expect(result?.outcome).toBe(Object.hasOwn(SPRING_SUITE_REFUSALS, id) ? "refused" : "passed");
  });
}

function describeHttpProfile(profile: SuiteProfile): void {
  describe(`http suite, ${profile} profile`, () => {
    const cases = loadSuiteCases(profile);
    let app: RunningApp | undefined;
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      app = await startSpringApp(jar);
      report = await runSuite({
        baseUrl: app.baseUrl,
        target: TARGET,
        profile,
        credentials,
        cases,
        refusals: refusalsOf(cases),
      });
      writeSuiteReport(report, reportFileOf(profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await app?.close();
    });

    testEachCase(cases, () => report);
  });
}

// The allow-listed variant needs the route in the config, so it boots the second jar; the other cases boot the first.
async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  const refusals = refusalsOf(cases);
  const onMainJar = await runBootSuite({
    target: TARGET,
    cases,
    refusals: { ...refusals, [ALLOW_LISTED_CASE]: ALLOW_LISTED_ELSEWHERE },
    command: "java",
    args: ["-jar", jar],
    cwd: reportDirectory,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
  const allowListedCases = cases.filter((suiteCase) => suiteCase.id === ALLOW_LISTED_CASE);
  const onAllowListedJar = await runBootSuite({
    target: TARGET,
    cases: allowListedCases,
    refusals: refusalsOf(allowListedCases),
    command: "java",
    args: ["-jar", allowListedJar],
    cwd: reportDirectory,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
  const merged = onMainJar.cases.map(
    (result) => onAllowListedJar.cases.find((other) => other.id === result.id) ?? result,
  );

  return suiteReportOf({ target: TARGET, profile: "boot" }, merged);
}

// Behind a prefix-stripping proxy the app sets the forwarded-headers strategy; the boundary strips the request's own
// context path, so a contract route still matches (ADR 0022 "Routes").
describe("behind a proxy with a forwarded prefix", () => {
  let app: RunningApp | undefined;

  beforeAll(async () => {
    app = await startSpringApp(jar, { "server.forward-headers-strategy": "framework" });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  test("a contract route answers under the forwarded prefix", async () => {
    const response = await fetch(`${app?.baseUrl}/v1/health`, {
      headers: { "x-forwarded-prefix": "/edge" },
    });

    expect(response.status).toBe(200);
  });
});

describeHttpProfile("default");
describeHttpProfile("hand-written");

describe("http suite, boot profile", () => {
  const cases = loadSuiteCases("boot");
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    report = await runBootProfile(cases);
    writeSuiteReport(report, reportFileOf("boot"));
  }, SUITE_TIMEOUT_MS);

  testEachCase(cases, () => report);
});
