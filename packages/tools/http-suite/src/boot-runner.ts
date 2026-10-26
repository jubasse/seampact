// Runs the boot profile: starts the sample app once per boot case, in a process of its own with the case's variant,
// and checks that it starts or refuses to start with the named diagnostic (ADR 0015 "Boot tests").
import { spawn } from "node:child_process";
import { BOOT_PROFILE, BOOT_STARTED_LINE, BOOT_VARIANT_ENV } from "./boot-variant.js";
import type { BootExpectation, SuiteCase } from "./suite-case.js";
import { type CaseResult, type SuiteReport, suiteReportOf } from "./suite-report.js";
import {
  caseHeader,
  refusedResult,
  refuseForeignCases,
  refuseUnknownRefusals,
} from "./suite-runner.js";

export interface BootRunOptions {
  /** The server target the sample app was built with, as the report names it. */
  readonly target: string;
  readonly cases: readonly SuiteCase[];
  /** Cases the sample app does not run, by case id, with the reason the report names. */
  readonly refusals?: Readonly<Record<string, string>>;
  /** The command that starts the sample app, run in `cwd` with the variant in its environment. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** How long one boot may take before the runner stops it and fails the case. */
  readonly bootTimeoutMs?: number;
}

/** What one boot process did: its exit code (`undefined` when stopped) and what it wrote. */
export interface BootAttempt {
  readonly exitCode: number | undefined;
  readonly output: string;
  readonly timedOut: boolean;
}

const DEFAULT_BOOT_TIMEOUT_MS = 60_000;
// A failure quotes the end of the output, where the diagnostic of a failed boot is.
const QUOTED_OUTPUT_LENGTH = 1500;

export async function runBootSuite(options: BootRunOptions): Promise<SuiteReport> {
  const refusals = options.refusals ?? {};

  refuseForeignCases(options.cases, BOOT_PROFILE);
  refuseUnknownRefusals(options.cases, refusals);

  const results: CaseResult[] = [];

  for (const suiteCase of options.cases) {
    const reason = refusals[suiteCase.id];

    results.push(
      reason === undefined
        ? await runBootCase(suiteCase, options)
        : refusedResult(suiteCase, reason),
    );
  }

  return suiteReportOf({ target: options.target, profile: BOOT_PROFILE }, results);
}

async function runBootCase(suiteCase: SuiteCase, options: BootRunOptions): Promise<CaseResult> {
  const expectation = suiteCase.boot;

  if (expectation === undefined) {
    throw new Error(`http-suite: the case '${suiteCase.id}' holds no boot expectation`);
  }

  const attempt = await startSampleApp(expectation, options);
  const failures = bootFailures(expectation, attempt);

  return {
    ...caseHeader(suiteCase),
    outcome: failures.length === 0 ? "passed" : "failed",
    failures,
  };
}

/** Each way the boot attempt differs from the expectation. */
export function bootFailures(expectation: BootExpectation, attempt: BootAttempt): string[] {
  const started = attempt.output.includes(BOOT_STARTED_LINE);
  const quoted = `output: ${JSON.stringify(attempt.output.slice(-QUOTED_OUTPUT_LENGTH))}`;

  if (attempt.timedOut) {
    return [`the '${expectation.variant}' app neither started nor exited in time; ${quoted}`];
  }

  if (expectation.outcome === "starts") {
    return started && attempt.exitCode === 0
      ? []
      : [`the '${expectation.variant}' app did not start (exit ${attempt.exitCode}); ${quoted}`];
  }

  if (started || attempt.exitCode === 0) {
    return [`the '${expectation.variant}' app started, expected a refusal; ${quoted}`];
  }

  const output = withoutWhitespace(attempt.output);
  const missing = expectation.diagnostic.filter(
    (text) => !output.includes(withoutWhitespace(text)),
  );

  return missing.length === 0
    ? []
    : [
        `the '${expectation.variant}' app refused without ${missing.map((text) => JSON.stringify(text)).join(", ")}; ${quoted}`,
      ];
}

// A console wraps a long diagnostic at its width, even inside a quoted name: its whitespace is presentation.
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function startSampleApp(
  expectation: BootExpectation,
  options: BootRunOptions,
): Promise<BootAttempt> {
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: { ...process.env, [BOOT_VARIANT_ENV]: expectation.variant },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS);

  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(`http-suite: cannot run '${options.command}' for a boot case: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? undefined,
        output: Buffer.concat(chunks).toString("utf8"),
        timedOut,
      });
    });
  });
}
