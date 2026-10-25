// Runs the shared http suite's `default`, `hand-written`, `boot` and `pack:spring` profiles against the Spring Boot
// consumer's jars (ADR 0015 "Suite profiles") and writes one report per profile. The jars and the report directory
// come from the environment: SEAMPACT_SPRING_JAR, SEAMPACT_SPRING_ALLOW_LISTED_JAR, SEAMPACT_SPRING_PACK_JAR and
// SEAMPACT_SPRING_REPORTS.
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
import { type RunningApp, startSpringApp } from "./spring-app.ts";
import { PACK_SPRING_SUITE_REFUSALS, SPRING_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "spring-boot";
const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the jar built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];
const SPRING_PACK = "@seampact/pack-spring";
const PACK_SPRING_GOLDEN = join(import.meta.dirname, "../../../../../fixtures/golden/pack-spring");

const jar = requiredEnvironment("SEAMPACT_SPRING_JAR");
const allowListedJar = requiredEnvironment("SEAMPACT_SPRING_ALLOW_LISTED_JAR");
const packJar = requiredEnvironment("SEAMPACT_SPRING_PACK_JAR");
const reportDirectory = requiredEnvironment("SEAMPACT_SPRING_REPORTS");
const credentials = readCredentials();

// The boot processes run in the report directory, so it exists before any profile writes there.
mkdirSync(reportDirectory, { recursive: true });

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
        refusals: refusalsOf(cases, SPRING_SUITE_REFUSALS),
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await app?.close();
    });

    testEachCase(cases, () => report, SPRING_SUITE_REFUSALS, test);
  });
}

function packSpringIr(contract: string): ContractIR {
  return JSON.parse(readFileSync(join(PACK_SPRING_GOLDEN, `${contract}.ir.json`), "utf8"));
}

// The pack-spring jar serves the reference contract with `@seampact/pack-spring` applied; its profile reads the
// default cases through the pack's paging style, then runs the pack's own cases.
describe("http suite, pack:spring profile", () => {
  const pack = packProfileOf([packSpringIr("tasks"), packSpringIr("tasksService")], SPRING_PACK);
  const refusals = {
    ...pack.refusals,
    ...refusalsOf(pack.cases, { ...SPRING_SUITE_REFUSALS, ...PACK_SPRING_SUITE_REFUSALS }),
  };
  let app: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    app = await startSpringApp(packJar);
    report = await runSuite({
      baseUrl: app.baseUrl,
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
    await app?.close();
  });

  testEachCase(pack.cases, () => report, refusals, test);
});

// The allow-listed variant needs the route in the config, so it boots the second jar; the other cases boot the first.
async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  const refusals = refusalsOf(cases, SPRING_SUITE_REFUSALS);
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
    refusals: refusalsOf(allowListedCases, SPRING_SUITE_REFUSALS),
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
    writeSuiteReport(report, reportFileOf(reportDirectory, "boot"));
  }, SUITE_TIMEOUT_MS);

  testEachCase(cases, () => report, SPRING_SUITE_REFUSALS, test);
});

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(SPRING_SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
