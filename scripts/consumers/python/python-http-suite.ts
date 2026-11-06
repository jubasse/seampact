// Runs the shared http suite's `default`, `hand-written`, `boot` and `pack:laravel` profiles against an assembled Python
// consumer (ADR 0015 "Suite profiles") and writes one report per profile. The app directories, the virtual environment
// they run in and the report directory come from the environment, `<prefix>_APP`, `<prefix>_ALLOW_LISTED_APP`,
// `<prefix>_PACK_APP`, `<prefix>_VENV` and `<prefix>_REPORTS`; the target gives how its app is served and booted.
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
} from "../../../packages/tools/http-suite/src/index.ts";
import { goldenPackProfile } from "../golden-pack-profile.ts";
import { type PythonApp, pythonOf, type RunningApp } from "./python-app.ts";

/** What a Python target's suite run needs: its app, how it is served, and how one boot case starts it. */
export interface PythonSuiteTarget {
  readonly target: string;
  /** The environment prefix of the app directories, the virtual environment and the reports. */
  readonly environmentPrefix: string;
  readonly appOf: (appDirectory: string, venv: string) => PythonApp;
  readonly start: (app: PythonApp) => Promise<RunningApp>;
  /** The arguments to the venv's python that start the app once for a boot case, run in the app directory. */
  readonly bootArguments: readonly string[];
  readonly refusals: Readonly<Record<string, string>>;
}

const ALLOW_LISTED_CASE = "allow-listed-framework-route-boots";
const ALLOW_LISTED_ELSEWHERE = "Runs on the app built with the route allow-listed.";
const SUITE_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 120_000;
const TARGET_PROFILES: readonly SuiteProfile[] = [
  "default",
  "hand-written",
  "boot",
  "pack:laravel",
];

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
    readFileSync(join(import.meta.dirname, "../targets/spring-boot/credentials.json"), "utf8"),
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

export function describePythonHttpSuite(suiteTarget: PythonSuiteTarget): void {
  const { target, environmentPrefix, refusals } = suiteTarget;
  const venv = requiredEnvironment(`${environmentPrefix}_VENV`);
  const app = suiteTarget.appOf(requiredEnvironment(`${environmentPrefix}_APP`), venv);
  const allowListedApp = suiteTarget.appOf(
    requiredEnvironment(`${environmentPrefix}_ALLOW_LISTED_APP`),
    venv,
  );
  const packApp = suiteTarget.appOf(requiredEnvironment(`${environmentPrefix}_PACK_APP`), venv);
  const reportDirectory = requiredEnvironment(`${environmentPrefix}_REPORTS`);
  const credentials = readCredentials();

  mkdirSync(reportDirectory, { recursive: true });

  function describeHttpProfile(profile: SuiteProfile): void {
    describe(`http suite, ${profile} profile`, () => {
      const cases = loadSuiteCases(profile);
      let running: RunningApp | undefined;
      let report: SuiteReport | undefined;

      beforeAll(async () => {
        running = await suiteTarget.start(app);
        report = await runSuite({
          baseUrl: running.baseUrl,
          target,
          profile,
          credentials,
          cases,
          refusals: refusalsOf(cases, refusals),
        });
        writeSuiteReport(report, reportFileOf(reportDirectory, profile));
      }, SUITE_TIMEOUT_MS);

      afterAll(async () => {
        await running?.close();
      });

      testEachCase(cases, () => report, refusals, test);
    });
  }

  // A boot starts the app once with the case's variant, which runs the boot check.
  function bootRun(
    cases: readonly SuiteCase[],
    appDirectory: string,
    caseRefusals: Record<string, string>,
  ) {
    return runBootSuite({
      target,
      cases,
      refusals: caseRefusals,
      command: pythonOf(venv),
      args: [...suiteTarget.bootArguments],
      cwd: appDirectory,
      bootTimeoutMs: BOOT_TIMEOUT_MS,
    });
  }

  // The allow-listed variant needs the route in the config, so it boots the second app; the other cases boot the first.
  async function runBootProfile(cases: readonly SuiteCase[]): Promise<SuiteReport> {
    const onMainApp = await bootRun(cases, app.appDirectory, {
      ...refusalsOf(cases, refusals),
      [ALLOW_LISTED_CASE]: ALLOW_LISTED_ELSEWHERE,
    });
    const allowListedCases = cases.filter((suiteCase) => suiteCase.id === ALLOW_LISTED_CASE);
    const onAllowListedApp = await bootRun(
      allowListedCases,
      allowListedApp.appDirectory,
      refusalsOf(allowListedCases, refusals),
    );
    const merged = onMainApp.cases.map(
      (result) => onAllowListedApp.cases.find((other) => other.id === result.id) ?? result,
    );

    return suiteReportOf({ target, profile: "boot" }, merged);
  }

  // What the shared cases do not reach: a request target in absolute form, which the server passes with its origin.
  describe(`boundary edges of the ${target} runtime`, () => {
    let running: RunningApp | undefined;

    beforeAll(async () => {
      running = await suiteTarget.start(app);
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

  // The pack-laravel app serves the reference contract with `@seampact/pack-laravel` applied; its profile reads the
  // default cases through the pack's format and paging style, then runs the pack's own cases.
  describe("http suite, pack:laravel profile", () => {
    const pack = goldenPackProfile("pack-laravel");
    const packRefusals = { ...pack.refusals, ...refusalsOf(pack.cases, refusals) };
    let running: RunningApp | undefined;
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      running = await suiteTarget.start(packApp);
      report = await runSuite({
        baseUrl: running.baseUrl,
        target,
        profile: pack.profile,
        credentials,
        cases: pack.cases,
        reader: pack.reader,
        refusals: packRefusals,
      });
      writeSuiteReport(report, reportFileOf(reportDirectory, pack.profile));
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      await running?.close();
    });

    testEachCase(pack.cases, () => report, packRefusals, test);
  });

  describe("http suite, boot profile", () => {
    const cases = loadSuiteCases("boot");
    let report: SuiteReport | undefined;

    beforeAll(async () => {
      report = await runBootProfile(cases);
      writeSuiteReport(report, reportFileOf(reportDirectory, "boot"));
    }, SUITE_TIMEOUT_MS);

    testEachCase(cases, () => report, refusals, test);
  });

  test("every refusal names a case of a profile the target runs", () => {
    const caseIds = new Set(
      TARGET_PROFILES.flatMap((profile) =>
        loadSuiteCases(profile).map((suiteCase) => suiteCase.id),
      ),
    );

    expect(Object.keys(refusals).filter((id) => !caseIds.has(id))).toEqual([]);
  });
}
