// The CI jobs a proof file cites as `<target>: ci: <workflow file>#<job id>`: each job must exist in its workflow, and
// the release gate counts it proven when the newest develop run of the job the fetcher recorded passed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Problem, TestRef } from "./model.ts";

export const WORKFLOWS_DIR = ".github/workflows";
/** The file the fetcher writes beside the http-suite reports, one result per cited job. */
export const CI_JOBS_FILE = "ci-jobs.json";
export const CI_JOBS_FORMAT = "seampact-ci-jobs/1";

const EXPRESSION_START = "${{";

/** The newest develop run of a cited job: its conclusion, the run id and the commit. */
export interface CiJobResult {
  ref: string;
  conclusion: string;
  run: number;
  commit: string;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** The key of a ci reference, `<workflow file>#<job id>`, as the fetcher's results name it. */
export function ciJobKey(ref: TestRef): string {
  return `${ref.path}#${ref.name}`;
}

/** The jobs of a workflow file, by id, with the name GitHub shows for them; undefined when the file is missing. */
export function workflowJobs(root: string, workflowFile: string): Map<string, string> | undefined {
  const path = join(root, WORKFLOWS_DIR, workflowFile);

  if (!existsSync(path)) return undefined;

  const workflow: unknown = parse(readFileSync(path, "utf8"));
  const jobs = isRec(workflow) && isRec(workflow.jobs) ? workflow.jobs : {};

  return new Map(
    Object.entries(jobs).map(([id, job]) => [
      id,
      isRec(job) && typeof job.name === "string" ? job.name : id,
    ]),
  );
}

/**
 * The line the fetcher reads for one cited job: workflow file, job id, the name to match in a run's jobs and the
 * match mode, tab-separated. A name with an expression (a matrix row) matches every job whose name starts with the
 * text before the expression.
 */
export function ciJobLine(ref: TestRef, displayName: string): string {
  const expressionAt = displayName.indexOf(EXPRESSION_START);
  const [name, mode] =
    expressionAt === -1 ? [displayName, "exact"] : [displayName.slice(0, expressionAt), "prefix"];

  return [ref.path, ref.name, name, mode].join("\t");
}

/** The fetcher's results under [directory], by job key; none when it wrote no results file. */
export function loadCiJobResults(directory: string, problems: Problem[]): Map<string, CiJobResult> {
  const file = join(directory, CI_JOBS_FILE);
  const results = new Map<string, CiJobResult>();

  if (!existsSync(file)) return results;

  const content: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (!isRec(content) || content.format !== CI_JOBS_FORMAT || !Array.isArray(content.jobs)) {
    problems.push({
      file,
      message: `not a CI job results file (expected format ${CI_JOBS_FORMAT})`,
    });

    return results;
  }

  for (const job of content.jobs) {
    if (
      !isRec(job) ||
      typeof job.ref !== "string" ||
      typeof job.conclusion !== "string" ||
      typeof job.run !== "number" ||
      typeof job.commit !== "string"
    ) {
      problems.push({
        file,
        message: "malformed CI job result: needs ref, conclusion, run and commit",
      });
      continue;
    }

    results.set(job.ref, {
      ref: job.ref,
      conclusion: job.conclusion,
      run: job.run,
      commit: job.commit,
    });
  }

  return results;
}
