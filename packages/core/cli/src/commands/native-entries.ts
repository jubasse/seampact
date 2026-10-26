import type { TargetRole } from "@seampact/codegen-core";
import type { CliIo } from "../cli-io.js";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import { isNativeTargetUse, type LoadedAppConfig } from "../config/index.js";

// How a run treats the target entries whose `use` is a Maven coordinate or a Composer package (ADR 0009). The Node
// CLI refuses them when it loads the targets. The standalone binary leaves them to their build plugin, writes or
// checks the app's documents and pinned bundles, and refuses every npm entry with `npmEntryRefusal` (ADR 0010).
export type NativeEntryPolicy =
  | { readonly kind: "refuse" }
  | { readonly kind: "leave"; readonly npmEntryRefusal: CliProblem };

export const REFUSE_NATIVE_ENTRIES: NativeEntryPolicy = { kind: "refuse" };

// Every native target is a server target (ADR 0010), so a native entry's apis get the app's default documents.
export const NATIVE_ENTRY_ROLE: TargetRole = "server";

// Under `leave`, the policy's refusal for each npm entry: the host loads no npm target.
export function npmEntryProblems(config: LoadedAppConfig, policy: NativeEntryPolicy): CliProblem[] {
  if (policy.kind === "refuse") return [];

  return config.entries
    .filter(({ entry }) => !isNativeTargetUse(entry.use))
    .map(({ entry }) => ({ ...policy.npmEntryRefusal, where: entryWhere(entry.id) }));
}

// The app's entries split into those the run generates and those it leaves to their build plugin.
export function splitNativeEntries(
  config: LoadedAppConfig,
  policy: NativeEntryPolicy,
): { generated: LoadedAppConfig; left: LoadedAppConfig["entries"] } {
  if (policy.kind === "refuse") return { generated: config, left: [] };

  return {
    generated: {
      ...config,
      entries: config.entries.filter(({ entry }) => !isNativeTargetUse(entry.use)),
    },
    left: config.entries.filter(({ entry }) => isNativeTargetUse(entry.use)),
  };
}

export function printLeftEntries(io: CliIo, left: LoadedAppConfig["entries"]): void {
  for (const { entry } of left) {
    io.stdout(
      `entry '${entry.id}' uses '${entry.use}', which its build plugin generates: left to it.\n`,
    );
  }
}
