// The HTTP cases that run on the sample app started with a boot variant, in a process of its own (`serve-entry.mts`),
// in place of the main server: a behaviour only an app misconfigured on purpose shows, such as a mount mismatch the
// framework learns from the request.
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  BOOT_VARIANT_ENV,
  type BootVariant,
  outsideTargetsReason,
  type SuiteCase,
} from "@seampact/http-suite";

/** The line the serve process writes once it listens, followed by its base URL. */
export const SERVING_LINE_PREFIX = "seampact-suite: serving ";

/** The variant app each case runs on, by case id. */
const VARIANT_APP_OF_CASE: Readonly<Record<string, BootVariant>> = {
  "mount-mismatch-refused-at-first-request": "mount-mismatch",
};

const SERVE_TIMEOUT_MS = 60_000;
// A failed start is told by the end of the output, where the server prints the cause.
const QUOTED_OUTPUT_LENGTH = 1500;

/** The cases of a run on one variant app. */
export interface VariantAppRun {
  readonly variant: BootVariant;
  readonly cases: readonly SuiteCase[];
}

/** How the run sends cases to a server: its base URL and the cases, the refusals already applied. */
export type CasesOnServer<Result> = (
  baseUrl: string,
  cases: readonly SuiteCase[],
) => Promise<Result>;

/** The refusal the main server's run takes for each case of [cases] that runs on a variant app of [target] instead. */
export function variantAppRefusals(
  cases: readonly SuiteCase[],
  target: string,
): Record<string, string> {
  return Object.fromEntries(
    cases.flatMap((suiteCase) => {
      const variant = VARIANT_APP_OF_CASE[suiteCase.id];

      if (variant === undefined || outsideTargetsReason(suiteCase, target) !== undefined) return [];

      return [[suiteCase.id, `runs on the '${variant}' app`]];
    }),
  );
}

/**
 * Runs each case of [cases] that a variant app takes, on [target], and not refused by [refusals], on that app started
 * from [consumerRoot]; a variant whose cases are all refused or outside the target starts no process.
 */
export async function runOnVariantApps<Result>(
  cases: readonly SuiteCase[],
  target: string,
  refusals: Readonly<Record<string, string>>,
  consumerRoot: string,
  casesOnServer: CasesOnServer<Result>,
): Promise<Result[]> {
  const results: Result[] = [];

  for (const run of variantAppRunsOf(cases, target, refusals)) {
    const app = await startVariantApp(run.variant, consumerRoot);

    try {
      results.push(await casesOnServer(app.baseUrl, run.cases));
    } finally {
      app.process.kill("SIGTERM");
    }
  }

  return results;
}

function variantAppRunsOf(
  cases: readonly SuiteCase[],
  target: string,
  refusals: Readonly<Record<string, string>>,
): VariantAppRun[] {
  const runs = new Map<BootVariant, SuiteCase[]>();

  for (const suiteCase of cases) {
    const variant = VARIANT_APP_OF_CASE[suiteCase.id];
    const runsHere =
      refusals[suiteCase.id] === undefined && outsideTargetsReason(suiteCase, target) === undefined;

    if (variant !== undefined && runsHere)
      runs.set(variant, [...(runs.get(variant) ?? []), suiteCase]);
  }

  return [...runs].map(([variant, variantCases]) => ({ variant, cases: variantCases }));
}

interface VariantApp {
  readonly baseUrl: string;
  readonly process: ChildProcess;
}

function startVariantApp(variant: BootVariant, consumerRoot: string): Promise<VariantApp> {
  const child = spawn(process.execPath, ["--import", "tsx", "test/serve-entry.mts"], {
    cwd: consumerRoot,
    env: { ...process.env, [BOOT_VARIANT_ENV]: variant },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";

  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  return new Promise((resolve, reject) => {
    const fail = (problem: string) => {
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(
        new Error(
          `the '${variant}' app ${problem}; output: ${output.slice(-QUOTED_OUTPUT_LENGTH)}`,
        ),
      );
    };

    const timer = setTimeout(
      () => fail(`did not serve within ${SERVE_TIMEOUT_MS} ms`),
      SERVE_TIMEOUT_MS,
    );

    createInterface({ input: child.stdout }).on("line", (line) => {
      output += `${line}\n`;

      if (!line.startsWith(SERVING_LINE_PREFIX)) return;

      clearTimeout(timer);
      resolve({ baseUrl: line.slice(SERVING_LINE_PREFIX.length), process: child });
    });
    child.on("error", (error) => fail(`cannot start: ${error.message}`));
    child.on("exit", (code) => fail(`exited with ${code} before it served`));
  });
}
