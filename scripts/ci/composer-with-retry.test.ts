import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";

const WRAPPER_SCRIPT = join(REPO_ROOT, ".github/actions/composer-cache/composer-with-retry.sh");

function isNetworkError(composerOutput: string): boolean {
  const run = spawnSync(
    "bash",
    ["-c", `source "${WRAPPER_SCRIPT}"; composer_output_is_network_error`],
    {
      input: composerOutput,
      encoding: "utf8",
    },
  );

  return run.status === 0;
}

// A fake composer that fails with the given output on its first call and succeeds on the next.
function runWithFakeComposer(
  subcommand: string,
  firstRunOutput: string,
): {
  status: number | null;
  output: string;
  calls: number;
} {
  const directory = mkdtempSync(join(tmpdir(), "composer-retry-"));
  const counter = join(directory, "calls");
  const fake = join(directory, "composer");

  writeFileSync(counter, "0");
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
calls=$(( $(cat "${counter}") + 1 ))
echo "$calls" > "${counter}"
if [ "$calls" -eq 1 ]; then
  echo '${firstRunOutput}'
  exit 2
fi
echo installed
`,
  );
  chmodSync(fake, 0o755);

  const run = spawnSync("bash", [WRAPPER_SCRIPT, subcommand, "--no-interaction"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
  });
  const calls = Number(spawnSync("cat", [counter], { encoding: "utf8" }).stdout);

  return { status: run.status, output: run.stdout, calls };
}

describe("the composer network error classifier", () => {
  it.each([
    "curl error 28 while downloading https://packagist.org/api/security-advisories/: Operation timed out after 10000 milliseconds",
    "Loading composer repositories with package information\ncurl error 28 while downloading https://repo.packagist.org/p2/a/b.json: Operation timed out",
    "curl error 6 while downloading https://repo.packagist.org/packages.json: Could not resolve host",
    "curl error 7 while downloading https://repo.packagist.org/p2/a/b.json: Failed to connect",
    "curl error 35 while downloading https://repo.packagist.org/p2/a/b.json: SSL connect error",
    "The following exception is caused by a lack of network: Connection timed out",
    "curl error 52 while downloading https://repo.packagist.org/p2/a/b.json: Empty reply from server",
    "curl error 56 while downloading https://codeload.github.com/a/b/zip/c: Recv failure: Connection reset by peer",
    'The "https://repo.packagist.org/p2/a/b.json" file could not be downloaded (HTTP/2 502 )',
    'The "https://api.github.com/repos/a/b/zipball/c" file could not be downloaded (HTTP/1.1 503 Service Unavailable)',
  ])("treats %s as a network error", (snippet) => {
    expect(isNetworkError(snippet)).toBe(true);
  });

  it.each([
    "Your requirements could not be resolved to an installable set of packages.",
    "Found 1 security vulnerability advisory affecting 1 package: PKSA-1234",
    "Warning: The lock file is not up to date with the latest changes in composer.json.",
    "curl error 280 while downloading https://example.test",
    "curl error 22 while downloading https://example.test: The requested URL returned error: 404",
    'The "https://repo.packagist.org/p2/a/b.json" file could not be downloaded (HTTP/2 404 )',
  ])("does not treat %s as a network error", (snippet) => {
    expect(isNetworkError(snippet)).toBe(false);
  });
});

describe.each(["install", "update"])("composer %s with one retry", (subcommand) => {
  it("reruns once and names the error after a network failure", () => {
    const result = runWithFakeComposer(
      subcommand,
      "curl error 28 while downloading https://packagist.org/x",
    );

    expect(result.calls).toBe(2);
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      `Retrying composer ${subcommand} once after a network error (curl error 28)`,
    );
  });

  it("fails at once on any other error", () => {
    const result = runWithFakeComposer(subcommand, "Your requirements could not be resolved");

    expect(result.calls).toBe(1);
    expect(result.status).toBe(2);
  });
});
