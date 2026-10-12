// Runs one binary on the fixtures and compares it byte for byte with the reference output
// that `node dist/bundle.cjs` produced on Linux.
// Usage: node scripts/smoke.mjs <binary> <reference-dir> [--label <name>]
// Env: EXPECT_CRLF=1 asserts the checked-out fixture has CRLF line endings.
//      SMOKE_ENV='{"TZ":"Asia/Kolkata","LANG":"fr_FR.UTF-8"}' extra environment for the binary.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [binary, referenceDir] = process.argv.slice(2);
const label = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1]
  : binary;
if (!binary || !referenceDir) {
  console.error("usage: smoke.mjs <binary> <reference-dir> [--label <name>]");
  process.exit(2);
}

const env = { ...process.env, ...JSON.parse(process.env.SMOKE_ENV ?? "{}") };
const okDir = join(root, "fixtures/ok");
const anchorDir = join(root, "fixtures/anchor");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

if (process.env.EXPECT_CRLF === "1") {
  check(
    readFileSync(join(okDir, "a.yaml"), "utf8").includes("\r\n"),
    "fixture is not checked out with CRLF",
  );
}

const exec = (dir) => spawnSync(binary, [dir], { env, encoding: "buffer" });

const firstStart = process.hrtime.bigint();
const ok = exec(okDir);
const firstMs = Number(process.hrtime.bigint() - firstStart) / 1e6;
const wantOut = readFileSync(join(referenceDir, "ok.stdout"));
check(ok.status === 0, `ok fixture exit code ${ok.status}, stderr: ${ok.stderr?.toString()}`);
check(
  Buffer.compare(ok.stdout, wantOut) === 0,
  "ok fixture stdout differs from the Node reference",
);
check(ok.stderr.length === 0, "ok fixture wrote to stderr");

const bad = exec(anchorDir);
const wantErr = readFileSync(join(referenceDir, "anchor.stderr"));
check(bad.status !== 0, "anchor fixture exited 0");
check(bad.stdout.length === 0, "anchor fixture wrote to stdout");
check(
  Buffer.compare(bad.stderr, wantErr) === 0,
  `anchor message differs: ${bad.stderr.toString()}`,
);
check(/^a\.yaml:\d+:\d+: /.test(bad.stderr.toString()), "anchor message is not located");

// Measures (recorded, not gated): size, first launch (the first run of the
// file on this runner, includes any OS scan) and warm start (median of 7 later runs).
const runs = [];
for (let i = 0; i < 7; i++) {
  const t0 = process.hrtime.bigint();
  spawnSync(binary, [okDir], { env, stdio: "ignore" });
  runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
runs.sort((a, b) => a - b);
const row = {
  label,
  sizeMB: +(statSync(binary).size / 1048576).toFixed(1),
  firstMs: +firstMs.toFixed(0),
  warmMs: +runs[3].toFixed(0),
  exitCode: ok.status,
  pass: failures.length === 0,
};
console.log(JSON.stringify(row));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| ${label} | ${row.pass ? "pass" : "FAIL"} | ${row.sizeMB} | ${row.firstMs} | ${row.warmMs} |\n`,
  );
}
if (process.env.SMOKE_RESULT) writeFileSync(process.env.SMOKE_RESULT, `${JSON.stringify(row)}\n`);
for (const f of failures) console.error(`smoke: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
