import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "run-gate-workflows.sh");
const COMMIT = "c".repeat(40);
const OTHER_COMMIT = "d".repeat(40);
const READ_ATTEMPTS = 5;
const WORKFLOW_LIST = "p5-adonis.yml\trelease-gate\np6-jvm-core.yml\n";

interface FakeGitHub {
  /** What a dispatch answers as the new run's id. */
  runId?: string;
  /** The reads of the run's state that fail before one answers. */
  failedReads?: number;
  /** The status, conclusion and commit a read answers. */
  state?: string;
}

/**
 * A `gh` that records each dispatch, starts every workflow as run [runId] and fails the first [failedReads] reads of
 * the run's state before answering [state]; a `sleep` that only records its pause.
 */
function fakeTools(directory: string, github: FakeGitHub): void {
  const { runId = "7", failedReads = 0, state = `completed success ${COMMIT}` } = github;

  writeFileSync(
    join(directory, "gh"),
    [
      "#!/usr/bin/env bash",
      'case "$*" in',
      `  *dispatches*) echo "$*" >> "${directory}/dispatches"; echo "${runId}" ;;`,
      `  *actions/runs/${runId}*)`,
      `    reads=$(( $(cat "${directory}/reads" 2>/dev/null || echo 0) + 1 ))`,
      `    echo "$reads" > "${directory}/reads"`,
      `    if [ "$reads" -le ${failedReads} ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi`,
      `    echo "${state}" ;;`,
      '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "sleep"),
    `#!/usr/bin/env bash\necho "$1" >> "${directory}/pauses"\n`,
  );
  writeFileSync(join(directory, "workflows.txt"), WORKFLOW_LIST);
  chmodSync(join(directory, "gh"), 0o755);
  chmodSync(join(directory, "sleep"), 0o755);
}

describe("the wait for the gate runs", () => {
  let tools: string;

  beforeEach(() => {
    tools = mkdtempSync(join(tmpdir(), "gate-runs-"));
  });

  afterEach(() => {
    rmSync(tools, { recursive: true, force: true });
  });

  const runScript = () =>
    spawnSync(
      "bash",
      [SCRIPT, "main", COMMIT, join(tools, "workflows.txt"), join(tools, "runs.txt")],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${tools}:${process.env.PATH ?? ""}` },
      },
    );
  const written = (file: string) => readFileSync(join(tools, file), "utf8").trim().split("\n");

  it("starts each listed workflow, the release-gate input where it takes it, and records each run", () => {
    fakeTools(tools, {});

    const run = runScript();
    const dispatches = written("dispatches");

    expect(run.status).toBe(0);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[0]).toContain("workflows/p5-adonis.yml/dispatches");
    expect(dispatches[0]).toContain("inputs[release-gate]=true");
    expect(dispatches[1]).toContain("workflows/p6-jvm-core.yml/dispatches");
    expect(dispatches[1]).not.toContain("inputs[");
    expect(written("runs.txt")).toEqual(["7", "7"]);
    expect(run.stdout).toContain(`p6-jvm-core.yml run 7 at ${COMMIT} concluded success`);
  });

  it("refuses a run at another commit than the release's", () => {
    fakeTools(tools, { state: `completed success ${OTHER_COMMIT}` });

    const run = runScript();

    expect(run.stderr).toContain(
      `p5-adonis.yml run 7 is at ${OTHER_COMMIT}, not ${COMMIT}: main moved, start the release again`,
    );
    expect(run.status).toBe(1);
  });

  it("fails on a run that did not succeed and on a dispatch that names no run", () => {
    fakeTools(tools, { state: `completed failure ${COMMIT}` });

    const failedRun = runScript();

    expect(failedRun.stdout).toContain(`p5-adonis.yml run 7 at ${COMMIT} concluded failure`);
    expect(failedRun.status).toBe(1);

    fakeTools(tools, { runId: "null" });

    const noRunId = runScript();

    expect(noRunId.stderr).toContain("starting p5-adonis.yml on main returned no run id");
    expect(noRunId.status).toBe(1);
  });

  it("refuses a list line that is not a workflow file and the known input, before starting anything", () => {
    fakeTools(tools, {});
    writeFileSync(join(tools, "workflows.txt"), "p5-adonis.yml\trelease-gate\n../x.yml\n");

    const run = runScript();

    expect(run.stderr).toContain("not a workflow line of gate-workflows: '../x.yml' ''");
    expect(written("dispatches")).toHaveLength(1);
    expect(run.status).toBe(1);
  });

  it("retries a failed read of a run's state with a doubling pause, then goes on", () => {
    fakeTools(tools, { failedReads: 2 });

    const run = runScript();

    expect(run.stderr).toContain("reading run 7 failed (attempt 1 of 5), retrying in 10s");
    expect(run.stderr).toContain("reading run 7 failed (attempt 2 of 5), retrying in 20s");
    expect(written("pauses")).toEqual(["10", "20"]);
    expect(run.stdout).toContain(`p5-adonis.yml run 7 at ${COMMIT} concluded success`);
    expect(run.status).toBe(0);
  });

  it("fails the wait once every read of a run's state failed", () => {
    fakeTools(tools, { failedReads: READ_ATTEMPTS });

    const run = runScript();

    expect(run.stderr).toContain(
      "reading run 7 failed 5 times: check the GitHub status, then start the release again",
    );
    expect(written("pauses")).toEqual(["10", "20", "40", "80"]);
    expect(run.status).toBe(1);
  });
});
