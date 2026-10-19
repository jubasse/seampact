// Runs the boot profile of the shared HTTP suite: each case starts the sample app in a process of its own with a
// misconfigured variant, through `boot-entry.mts`, and expects the named refusal or a start.
import { join } from "node:path";
import {
  loadSuiteCases,
  runBootSuite,
  type SuiteReport,
  writeSuiteReport,
} from "@seampact/http-suite";
import { beforeAll, describe } from "vitest";
import {
  CONSUMER_ROOT,
  refusalsOf,
  reportFileOf,
  SUITE_TARGET,
  testEachCase,
} from "./suite-run.mjs";

const PROFILE = "boot";
// Each boot starts a process that loads TypeScript sources; the slowest framework takes a few seconds.
const SUITE_TIMEOUT_MS = 300_000;

const cases = loadSuiteCases(PROFILE);
let report: SuiteReport | undefined;

beforeAll(async () => {
  report = await runBootSuite({
    target: SUITE_TARGET,
    cases,
    refusals: refusalsOf(cases),
    command: process.execPath,
    args: ["--import", "tsx", join("test", "boot-entry.mts")],
    cwd: CONSUMER_ROOT,
  });
  writeSuiteReport(report, reportFileOf(PROFILE));
}, SUITE_TIMEOUT_MS);

describe(`http suite, ${PROFILE} profile`, () => {
  testEachCase(cases, () => report);
});
