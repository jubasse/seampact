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
    "[ERROR] Could not transfer artifact org.example:x:pom:1.0 from/to central (https://repo.maven.apache.org/maven2): status code: 503",
    "npm error 429 Too Many Requests - PUT https://registry.npmjs.org/@seampact%2fcli",
    "npm error network request to https://registry.npmjs.org/x failed, reason: connect ETIMEDOUT 104.16.1.35:443",
    "ERR_PNPM_FETCH_502  GET https://registry.npmjs.org/x: Bad Gateway - 502",
    "error: Failed to fetch: `https://pypi.org/simple/x/` HTTP status server error (503 Service Unavailable)",
    "The 'https://repo.packagist.org/p2/x.json' URL could not be accessed (HTTP/2 403 Forbidden)",
    "Error: download of https://objects.githubusercontent.com/x failed: Read timed out",
  ])("are found in %s", (line) => {
    const run = matched(`build\tStep\tstarting\nbuild\tStep\t${line}\nbuild\tStep\tBUILD FAILED\n`);

    expect(run.stdout).toBe(`build\tStep\t${line}\n`);
    expect(run.status).toBe(0);
  });

  it.each([
    "AssertionError: expected 200 to be 404",
    "e: file.kt:3:5 Unresolved reference 'x'.",
    "golden tree differs: src/Tasks.java",
    'status 503, expected 200; body: {"error":"Service Unavailable"}',
    "Error: connect ETIMEDOUT 127.0.0.1:3000",
    "Error: read ECONNRESET from localhost:8080 (502 Bad Gateway)",
    "Error: connect ETIMEDOUT ::1:3000 via https://registry.npmjs.org/x",
    '✘ [ERROR] Could not resolve "./x"',
  ])("are not found in a failure of the code: %s", (line) => {
    const run = matched(`build\tStep\t${line}\nbuild\tStep\tBUILD FAILED\n`);

    expect(run.stdout).toBe("");
    expect(run.status).toBe(1);
  });
});
