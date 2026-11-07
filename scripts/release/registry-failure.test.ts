import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "registry-failure.sh");

const matched = (log: string) => spawnSync("bash", [SCRIPT], { input: log, encoding: "utf8" });

describe("the registry failure signatures of a failed job's log", () => {
  it.each([
    "> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 429 from server: Too Many Requests",
    "> Could not resolve org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20.",
    "> Repository MavenRepo is disabled due to earlier error below:",
    "[ERROR] Failed to execute goal: Could not transfer artifact org.example:x:pom:1.0 from/to central: status code: 503",
    "npm error code E429",
    "npm error code ETIMEDOUT",
    "ERR_PNPM_FETCH_502  GET https://registry.npmjs.org/x: Bad Gateway - 502",
    "error: Failed to fetch: `https://pypi.org/simple/x/` HTTP status server error (503 Service Unavailable)",
    "The 'https://repo.packagist.org/p2/x.json' URL could not be accessed (HTTP/2 403 Forbidden)",
  ])("are found in %s", (line) => {
    const run = matched(`build\tStep\tstarting\nbuild\tStep\t${line}\nbuild\tStep\tBUILD FAILED\n`);

    expect(run.stdout).toBe(`build\tStep\t${line}\n`);
    expect(run.status).toBe(0);
  });

  it.each([
    "AssertionError: expected 200 to be 404",
    "e: file.kt:3:5 Unresolved reference 'x'.",
    "golden tree differs: src/Tasks.java",
  ])("are not found in a failure of the code: %s", (line) => {
    const run = matched(`build\tStep\t${line}\nbuild\tStep\tBUILD FAILED\n`);

    expect(run.stdout).toBe("");
    expect(run.status).toBe(1);
  });
});
