import { type BundleVerifyResult, verifyBundle } from "@seampact/compiler";
import type { CliProblem } from "../cli-problem.js";

// A bundle its host already fetched and checked, handed over as a local bundle directory by source name
// (`--bundle-directory <source>=<dir>`): the run puts it through the pinned-bundle check against the source's own
// integrity and never fetches the source. The JVM build plugins hand over the bundles they resolved (ADR 0010).
export type LocalBundles = ReadonlyMap<string, string>;

export const NO_LOCAL_BUNDLES: LocalBundles = new Map();

export type LocalBundleOutcome =
  | { status: "verified"; result: BundleVerifyResult }
  | { status: "refused"; problem: CliProblem };

export function verifyLocalBundle(
  name: string,
  directory: string,
  integrity: string | undefined,
): LocalBundleOutcome {
  if (integrity === undefined) {
    return {
      status: "refused",
      problem: {
        code: "cli.bundle-directory.unpinned",
        message: `The source '${name}' is handed over as the local bundle ${directory}, and it pins no integrity to check it against.`,
        fix: "Pin the source's `integrity` in the app config.",
        where: `source '${name}'`,
      },
    };
  }

  return { status: "verified", result: verifyBundle(directory, integrity) };
}
