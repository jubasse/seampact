import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { matrixRows, type WorkflowJob } from "../../ci/matrix-rows.ts";
import { REPO_ROOT } from "../../golden/repo-root.ts";
import { type DistributionManifestEntry, releaseDistributionNames } from "./dist-manifest.ts";
import { distributionsToPlan } from "./pypi-plan.ts";

// The GitHub environments of the PyPI publish, one per distribution: each is the environment of one pending publisher
// on pypi.org, so a renamed or added distribution fails here rather than on PyPI on release day.
const PYPI_ENVIRONMENTS = [
  "pypi-seampact-codegen",
  "pypi-seampact-compiler",
  "pypi-seampact-django",
  "pypi-seampact-drf",
  "pypi-seampact-fastapi",
  "pypi-seampact-hooks",
  "pypi-seampact-ir",
  "pypi-seampact-ninja",
  "pypi-seampact-signed-webhooks",
];
const DISTRIBUTION_ENVIRONMENT = `pypi-\${{ matrix.distribution }}`;

interface PublishJob extends WorkflowJob {
  readonly environment?: string;
  readonly strategy?: WorkflowJob["strategy"] & { readonly "fail-fast"?: boolean };
}

const releaseWorkflow: { readonly jobs: Readonly<Record<string, PublishJob>> } = parse(
  readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8"),
);

function publishJob(): PublishJob {
  const job = releaseWorkflow.jobs["publish-pypi"];

  if (job === undefined) throw new Error("release.yml has no publish-pypi job");

  return job;
}

function publishedEnvironments(): string[] {
  const matrix = publishJob().strategy?.matrix;

  if (matrix === undefined) throw new Error("publish-pypi has no matrix");

  return matrixRows(matrix)
    .map((row) => `pypi-${String(row.distribution)}`)
    .sort();
}

const STATUS_FUNCTIONS = ["always()", "failure()", "cancelled()", "success()"];

function statusFunctionsIn(condition: string | undefined): string[] {
  if (condition === undefined) throw new Error("the job has no if condition");

  return STATUS_FUNCTIONS.filter((statusFunction) => condition.includes(statusFunction));
}

const entry = (file: string, name: string): DistributionManifestEntry => ({
  file,
  name,
  version: "1.2.3",
  kind: "sdist",
  sha256: "0".repeat(64),
});

describe("the PyPI publish", () => {
  it("publishes each distribution from its own environment, pypi-<distribution>", () => {
    expect(publishJob().environment).toBe(DISTRIBUTION_ENVIRONMENT);
    expect(publishedEnvironments()).toEqual(PYPI_ENVIRONMENTS);
  });

  it("has one job per python/* project", () => {
    expect(publishedEnvironments()).toEqual(
      releaseDistributionNames(REPO_ROOT)
        .map((name) => `pypi-${name}`)
        .sort(),
    );
  });

  it("names each environment in CONTRIBUTING.md, where the pending publishers are listed", () => {
    const contributing = readFileSync(join(REPO_ROOT, "CONTRIBUTING.md"), "utf8");

    for (const environment of PYPI_ENVIRONMENTS)
      expect(contributing).toContain(`\`${environment}\``);
  });

  it("lets every job finish when one fails", () => {
    expect(publishJob().strategy?.["fail-fast"]).toBe(false);
  });

  it("waits for the release approval", () => {
    expect(publishJob().needs).toContain("pypi-approval");
    expect(releaseWorkflow.jobs["pypi-approval"]?.environment).toBe("release");
  });

  it("has no status function in the condition of a leg or of the approval", () => {
    expect(statusFunctionsIn(publishJob().if)).toEqual([]);
    expect(statusFunctionsIn(releaseWorkflow.jobs["pypi-approval"]?.if)).toEqual([]);
  });

  it("finds a status function in a condition", () => {
    expect(statusFunctionsIn("always() && needs.prepare.outputs.dry-run == 'false'")).toEqual([
      "always()",
    ]);
    expect(statusFunctionsIn("needs.prepare.outputs.dry-run == 'false'")).toEqual([]);
  });

  it("plans one distribution's files, or all of them without a name", () => {
    const manifest = [
      entry("seampact_ir-1.2.3.tar.gz", "seampact-ir"),
      entry("seampact_hooks-1.2.3.tar.gz", "seampact-hooks"),
    ];
    const names = ["seampact-ir", "seampact-hooks"];

    expect(distributionsToPlan(manifest, names, "seampact-hooks")).toEqual([manifest[1]]);
    expect(distributionsToPlan(manifest, names, undefined)).toEqual(manifest);
    expect(() => distributionsToPlan(manifest, names, "seampact-other")).toThrow(
      "--distribution seampact-other is not a distribution of the release",
    );
  });
});
