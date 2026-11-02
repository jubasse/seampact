// Runs the shared http suite's `default`, `hand-written` and `boot` profiles against the assembled FastAPI consumer
// (ADR 0015 "Suite profiles") served by uvicorn, and writes one report per profile. The app directories, the virtual
// environment they run in and the report directory come from the environment: SEAMPACT_FASTAPI_APP,
// SEAMPACT_FASTAPI_ALLOW_LISTED_APP, SEAMPACT_FASTAPI_VENV and SEAMPACT_FASTAPI_REPORTS.
import { mkdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
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
  suiteReportOf,
  testEachCase,
  writeSuiteReport,
} from "../../../../../packages/tools/http-suite/src/index.ts";
import { pythonOf } from "../../../python/python-app.ts";
import {
  FASTAPI_APPLICATION,
  fastApiApp,
  type RunningApp,
  startFastApiApp,
} from "./fastapi-app.ts";
import { FASTAPI_SUITE_REFUSALS } from "./suite-refusals.ts";

const TARGET = "fastapi";
const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the app built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = ["default", "hand-written", "boot"];
const BOOT_SCRIPT = join(import.meta.dirname, "../../../python/boot.py");

const venv = requiredEnvironment("SEAMPACT_FASTAPI_VENV");
const app = fastApiApp(requiredEnvironment("SEAMPACT_FASTAPI_APP"), venv);
const allowListedApp = fastApiApp(requiredEnvironment("SEAMPACT_FASTAPI_ALLOW_LISTED_APP"), venv);
const reportDirectory = requiredEnvironment("SEAMPACT_FASTAPI_REPORTS");
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
      running = await startFastApiApp(app);
      report = await runSuite({
        baseUrl: running.baseUrl,
        target: TARGET,
        profile,
        credentials,
        cases,
        refusals: refusalsOf(cases, FASTAPI_SUITE_REFUSALS),
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    testEachCase(cases, () => report, FASTAPI_SUITE_REFUSALS, test);
  });
}

// A boot is a uvicorn start of the app with the case's variant, which runs the boot check at the app's startup.
function bootRun(
  cases: readonly SuiteCase[],
  appDirectory: string,
  refusals: Record<string, string>,
) {
  return runBootSuite({
    target: TARGET,
    cases,
    refusals,
    command: pythonOf(venv),
    args: [BOOT_SCRIPT, FASTAPI_APPLICATION],
    cwd: appDirectory,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
}

// The allow-listed variant needs the route in the config, so it boots the second app; the other cases boot the first.
async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
  const refusals = refusalsOf(cases, FASTAPI_SUITE_REFUSALS);
  const onMainApp = await bootRun(cases, app.appDirectory, {
    ...refusals,
    [ALLOW_LISTED_CASE]: ALLOW_LISTED_ELSEWHERE,
  });
  const allowListedCases = cases.filter((suiteCase) => suiteCase.id === ALLOW_LISTED_CASE);
  const onAllowListedApp = await bootRun(
    allowListedCases,
    allowListedApp.appDirectory,
    refusalsOf(allowListedCases, FASTAPI_SUITE_REFUSALS),
  );
  const merged = onMainApp.cases.map(
    (result) => onAllowListedApp.cases.find((other) => other.id === result.id) ?? result,
  );

  return suiteReportOf({ target: TARGET, profile: "boot" }, merged);
}

/** Sends [requestHead] as written on a raw socket and gives the status line of the reply. */
function rawStatusLine(baseUrl: string, requestHead: string): Promise<string> {
  const { hostname, port } = new URL(baseUrl);

  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => socket.write(requestHead));
    let received = "";

    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");

      const lineEnd = received.indexOf("\r\n");

      if (lineEnd === -1) return;

      socket.destroy();
      resolve(received.slice(0, lineEnd));
    });
    socket.on("error", reject);
  });
}

// What the shared cases do not reach: a request target in absolute form, which uvicorn passes with its origin.
describe("boundary edges of the FastAPI runtime", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startFastApiApp(app);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  test("a contract request in absolute form reaches its operation", async () => {
    const baseUrl = running?.baseUrl ?? "";
    const host = new URL(baseUrl).host;
    const statusLine = await rawStatusLine(
      baseUrl,
      `GET ${baseUrl}/v1/health HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
    );

    expect(statusLine).toBe("HTTP/1.1 200 OK");
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

  testEachCase(cases, () => report, FASTAPI_SUITE_REFUSALS, test);
});

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(FASTAPI_SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
