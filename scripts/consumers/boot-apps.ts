// Runs the http suite's boot profile across the sample apps a consumer builds: each case boots the app its variant
// starts as (`BOOT_APP_OF_VARIANT`), the main app otherwise, and one report merges the runs in case order.
import {
  BOOT_APP_OF_VARIANT,
  BOOT_APPS,
  type BootApp,
  refusalsOf,
  type SuiteCase,
  type SuiteReport,
  suiteReportOf,
} from "../../packages/tools/http-suite/src/index.ts";

/** A sample app of the consumer: the main one, built from `seampact.config.yaml`, or one of `BOOT_APPS`. */
export type ConsumerBootApp = "main" | BootApp;

const CONSUMER_BOOT_APPS: readonly ConsumerBootApp[] = ["main", ...BOOT_APPS];

/** Boots [cases] on the app [app], each case [refusals] names reported refused. */
export type BootOnApp = (
  app: ConsumerBootApp,
  cases: readonly SuiteCase[],
  refusals: Readonly<Record<string, string>>,
) => Promise<SuiteReport>;

/** The app a boot case starts. */
export function bootAppOf(suiteCase: SuiteCase): ConsumerBootApp {
  const variant = suiteCase.boot?.variant;

  return (variant === undefined ? undefined : BOOT_APP_OF_VARIANT[variant]) ?? "main";
}

/** The boot report of [target]: each case of [cases] booted on its app through [bootOn], refused by [refusals]. */
export async function runBootProfileOnApps(
  target: string,
  cases: readonly SuiteCase[],
  refusals: Readonly<Record<string, string>>,
  bootOn: BootOnApp,
): Promise<SuiteReport> {
  const results: SuiteReport["cases"][number][] = [];

  for (const app of CONSUMER_BOOT_APPS) {
    const appCases = cases.filter((suiteCase) => bootAppOf(suiteCase) === app);

    if (appCases.length === 0) continue;

    const report = await bootOn(app, appCases, refusalsOf(appCases, refusals));

    results.push(...report.cases);
  }

  const inCaseOrder = cases.flatMap((suiteCase) =>
    results.filter((result) => result.id === suiteCase.id),
  );

  return suiteReportOf({ target, profile: "boot" }, inCaseOrder);
}
