// Runs the shared http suite's `default` profile against one consumer built from the released artefacts (the Spring
// Boot jar, the Laravel app or the FastAPI app), served as its own consumer suite serves it, and writes the report.
// From the environment: SEAMPACT_PROOF_TARGET (`spring-boot`, `laravel` or `fastapi`), SEAMPACT_PROOF_APP (the jar,
// or the app directory), SEAMPACT_PROOF_VENV (the FastAPI app's virtual environment) and SEAMPACT_PROOF_REPORTS.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  loadSuiteCases,
  refusalsOf,
  reportFileOf,
  runSuite,
  type SuiteCredentials,
  type SuiteProfile,
  type SuiteReport,
  testEachCase,
  writeSuiteReport,
} from "../../../packages/tools/http-suite/src/index.ts";
import { fastApiApp, startFastApiApp } from "../../consumers/targets/fastapi/suite/fastapi-app.ts";
import { FASTAPI_SUITE_REFUSALS } from "../../consumers/targets/fastapi/suite/suite-refusals.ts";
import { startLaravelApp } from "../../consumers/targets/laravel/suite/laravel-app.ts";
import { LARAVEL_SUITE_REFUSALS } from "../../consumers/targets/laravel/suite/suite-refusals.ts";
import {
  type RunningApp,
  startSpringApp,
} from "../../consumers/targets/spring-boot/suite/spring-app.ts";
import { SPRING_SUITE_REFUSALS } from "../../consumers/targets/spring-boot/suite/suite-refusals.ts";

const PROFILE: SuiteProfile = "default";
const SUITE_TIMEOUT_MS = 600_000;
const CREDENTIALS_FILE = join(
  import.meta.dirname,
  "../../consumers/targets/spring-boot/credentials.json",
);

interface ProofTarget {
  readonly start: (app: string) => Promise<RunningApp>;
  readonly refusals: Readonly<Record<string, string>>;
}

const PROOF_TARGETS: Readonly<Record<string, ProofTarget>> = {
  "spring-boot": { start: (jar) => startSpringApp(jar), refusals: SPRING_SUITE_REFUSALS },
  laravel: {
    start: (appDirectory) => startLaravelApp(appDirectory),
    refusals: LARAVEL_SUITE_REFUSALS,
  },
  fastapi: {
    start: (appDirectory) =>
      startFastApiApp(fastApiApp(appDirectory, requiredEnvironment("SEAMPACT_PROOF_VENV"))),
    refusals: FASTAPI_SUITE_REFUSALS,
  },
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `Set ${name}: the proof runs against a consumer built from the released artefacts.`,
    );
  }

  return value;
}

function proofTarget(name: string): ProofTarget {
  const target = PROOF_TARGETS[name];

  if (target === undefined) {
    throw new Error(
      `SEAMPACT_PROOF_TARGET is '${name}': use one of ${Object.keys(PROOF_TARGETS).join(", ")}.`,
    );
  }

  return target;
}

function credentialField(shared: Record<string, unknown>, field: string): string {
  const value = shared[field];

  if (typeof value !== "string") throw new Error(`${CREDENTIALS_FILE} has no string \`${field}\``);

  return value;
}

function readCredentials(): SuiteCredentials {
  const shared: Record<string, unknown> = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8"));
  const throttleRetryAfterMs = shared.throttleRetryAfterMs;

  if (typeof throttleRetryAfterMs !== "number") {
    throw new Error(`${CREDENTIALS_FILE} has no number \`throttleRetryAfterMs\``);
  }

  return {
    userToken: credentialField(shared, "userToken"),
    throttledUserToken: credentialField(shared, "throttledUserToken"),
    serviceJwt: credentialField(shared, "serviceJwt"),
    stripeSecret: credentialField(shared, "stripeSecret"),
    throttleRetryAfterMs,
    foreignServiceJwt: credentialField(shared, "foreignServiceJwt"),
  };
}

const targetName = requiredEnvironment("SEAMPACT_PROOF_TARGET");
const target = proofTarget(targetName);
const app = requiredEnvironment("SEAMPACT_PROOF_APP");
const reportDirectory = requiredEnvironment("SEAMPACT_PROOF_REPORTS");

mkdirSync(reportDirectory, { recursive: true });

describe(`http suite, ${PROFILE} profile, ${targetName} from the released artefacts`, () => {
  const cases = loadSuiteCases(PROFILE);
  const refusals = refusalsOf(cases, target.refusals);
  let running: RunningApp | undefined;
  let report: SuiteReport | undefined;

  beforeAll(async () => {
    running = await target.start(app);
    report = await runSuite({
      baseUrl: running.baseUrl,
      target: targetName,
      profile: PROFILE,
      credentials: readCredentials(),
      cases,
      refusals,
    });
    writeSuiteReport(report, reportFileOf(reportDirectory, PROFILE));
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await running?.close();
  });

  testEachCase(cases, () => report, target.refusals, test);
});
