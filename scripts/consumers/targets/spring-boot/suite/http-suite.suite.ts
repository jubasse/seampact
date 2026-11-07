// Runs the shared http suite's `default`, `hand-written`, `boot`, `pack:spring` and `pack:laravel` profiles against the
// Spring Boot consumer's jars (ADR 0015 "Suite profiles") and writes one report per profile. The jars and the report
// directory come from the environment: SEAMPACT_SPRING_JAR, SEAMPACT_SPRING_ALLOW_LISTED_JAR,
// SEAMPACT_SPRING_ROUTE_CHECK_OFF_JAR, SEAMPACT_SPRING_HOOK_CHECK_OFF_JAR, SEAMPACT_SPRING_PACK_JAR,
// SEAMPACT_SPRING_PACK_LARAVEL_JAR and SEAMPACT_SPRING_REPORTS.
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
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { type ConsumerBootApp, runBootProfileOnApps } from "../../../boot-apps.ts";
import { type RunningApp, startSpringApp } from "./spring-app.ts";
import { SPRING_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "spring-boot";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];
const GOLDEN_DIRECTORY = join(import.meta.dirname, "../../../../../fixtures/golden");
const LIST_TASKS_PATH = "/v1/channels/10000000-0000-4000-8000-000000000001/tasks";

const jar = requiredEnvironment("SEAMPACT_SPRING_JAR");
const bootJarOf: Readonly<Record<ConsumerBootApp, string>> = {
  main: jar,
  "allow-listed": requiredEnvironment("SEAMPACT_SPRING_ALLOW_LISTED_JAR"),
  "route-check-off": requiredEnvironment("SEAMPACT_SPRING_ROUTE_CHECK_OFF_JAR"),
  "hook-check-off": requiredEnvironment("SEAMPACT_SPRING_HOOK_CHECK_OFF_JAR"),
};
const packJar = requiredEnvironment("SEAMPACT_SPRING_PACK_JAR");
const packLaravelJar = requiredEnvironment("SEAMPACT_SPRING_PACK_LARAVEL_JAR");
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
    deviceToken: shared.deviceToken,
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

function packGoldenIr(pack: string, contract: string): ContractIR {
  return JSON.parse(readFileSync(join(GOLDEN_DIRECTORY, pack, `${contract}.ir.json`), "utf8"));
}

// A pack jar serves the reference contract with the pack applied; its profile reads the default cases through the
// pack's format and paging style, then runs the pack's own cases.
function describePackProfile(pack: string, packJarPath: string): void {
  const profile = packProfileOf(
    [packGoldenIr(pack, "tasks"), packGoldenIr(pack, "tasksService")],
    `@seampact/${pack}`,
  );
  const refusals = {
    ...profile.refusals,
    ...refusalsOf(profile.cases, SPRING_SUITE_REFUSALS),
  };

  describe(`http suite, ${profile.profile} profile`, () => {
    let app: RunningApp | undefined;
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      app = await startSpringApp(packJarPath);
      report = await runSuite({
        baseUrl: app.baseUrl,
        target: TARGET,
        profile: profile.profile,
        credentials,
        cases: profile.cases,
        reader: profile.reader,
        refusals,
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile.profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await app?.close();
    });

    testEachCase(profile.cases, () => report, refusals, test);
  });
}

// `pack:spring` proves Spring Data's page on the wire; `pack:laravel` a format that wraps every success body.
describePackProfile("pack-spring", packJar);
describePackProfile("pack-laravel", packLaravelJar);

// A null page is the handler's failure, not a reply to send as written: the api's 500 under `responses: warn` too,
// as on Node.
describe("under responses: warn, a handler's null page", () => {
  const nullPageCase: SuiteCase = {
    id: "null-page-under-warn",
    title: "A handler's null page is the api's 500 under responses: warn",
    checks: [],
    profiles: ["default"],
    script: { answers: { "tasks.listTasks": { status: 200, body: null } } },
    steps: [
      {
        request: {
          method: "GET",
          path: LIST_TASKS_PATH,
          headers: { authorization: "Bearer {{userToken}}" },
        },
        expect: { status: 500 },
      },
    ],
  };
  let app: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    app = await startSpringApp(jar, { "seampact.tasks.responses": "warn" });
    report = await runSuite({
      baseUrl: app.baseUrl,
      target: TARGET,
      profile: "default",
      credentials,
      cases: [nullPageCase],
      refusals: {},
    });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  testEachCase([nullPageCase], () => report, {}, test);
});

// A variant built from another app config boots that config's jar (`boot-apps.ts`); the other cases boot the first.
function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  return runBootProfileOnApps(TARGET, cases, SPRING_SUITE_REFUSALS, (app, appCases, refusals) =>
    runBootSuite({
      target: TARGET,
      cases: appCases,
      refusals,
      command: "java",
      args: ["-jar", bootJarOf[app]],
      cwd: reportDirectory,
      bootTimeoutMs: BOOT_TIMEOUT_MS,
    }),
  );
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
