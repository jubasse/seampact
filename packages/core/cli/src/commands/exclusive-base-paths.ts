import { mountedBasePaths, NO_MOUNT } from "@seampact/codegen-core";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import type { PlannedEntry } from "./entry-links.js";
import type { Step } from "./step.js";

// The apis of a target that routes each api by its base paths before the boundary (`exclusiveBasePaths`), such as
// one Next.js route directory per base path: two of them in one app whose mounted base paths are equal or nested
// are refused, since the more specific route would take the other api's paths and answer with its own 404.

interface ServedApi {
  readonly entryId: string;
  readonly api: string;
  readonly basePaths: readonly string[];
}

/** Done when no two apis of such targets share or nest a base path; else one problem per pair. */
export function exclusiveBasePathProblems(planned: readonly PlannedEntry[]): Step<void> {
  const served: ServedApi[] = planned
    .filter(({ target }) => target.metadata.exclusiveBasePaths === true)
    .flatMap(({ entry, apis }) =>
      apis.map((plannedApi) => ({
        entryId: entry.id,
        api: plannedApi.api,
        basePaths: mountedBasePaths(plannedApi.ir, entry.mount ?? NO_MOUNT),
      })),
    );
  const problems = served.flatMap((first, index) =>
    served.slice(index + 1).flatMap((second) => sharedBasePathProblems(first, second)),
  );

  return problems.length > 0
    ? { status: "refused", problems }
    : { status: "done", value: undefined };
}

function sharedBasePathProblems(first: ServedApi, second: ServedApi): CliProblem[] {
  return first.basePaths.flatMap((firstPath) =>
    second.basePaths
      .filter((secondPath) => overlaps(firstPath, secondPath))
      .map((secondPath) => sharedBasePathProblem(first, firstPath, second, secondPath)),
  );
}

// An empty base path is the target's own refusal, not a pair's.
function overlaps(firstPath: string, secondPath: string): boolean {
  if (firstPath === "" || secondPath === "") return false;

  return (
    firstPath === secondPath ||
    firstPath.startsWith(`${secondPath}/`) ||
    secondPath.startsWith(`${firstPath}/`)
  );
}

function sharedBasePathProblem(
  first: ServedApi,
  firstPath: string,
  second: ServedApi,
  secondPath: string,
): CliProblem {
  return {
    code: "path.base.shared.unsupported",
    message: `The api '${first.api}' of entry '${first.entryId}' is served under '${firstPath}' and the api '${second.api}' of entry '${second.entryId}' under '${secondPath}': the more specific route would take the other api's paths.`,
    fix: "Give the two apis base paths that neither equal nor contain each other, through their prefixes or the entries' 'mount'.",
    where: entryWhere(second.entryId, second.api),
  };
}
