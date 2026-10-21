// Runs one binary on the smoke apps and compares it with the reference the Node CLI produced on Linux: the IR
// files byte for byte, and the answers of the commands both carry. The apps are copied outside the repository,
// so a pack can only come from the packs embedded in the binary.
// Usage: node scripts/smoke.mjs <binary> <reference-dir> [--label <name>]
// Env: SMOKE_ENV='{"TZ":"Asia/Kolkata","LOG_TOKENS":"1"}' extra environment for the binary.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { irFileNames, runSmokeApp, SMOKE_APPS, writeSmokeApp } from "./smoke-apps.mjs";

const [binaryArgument, referenceArgument] = process.argv.slice(2);
const labelIndex = process.argv.indexOf("--label");
const label = labelIndex === -1 ? binaryArgument : process.argv[labelIndex + 1];

if (!binaryArgument || !referenceArgument) {
  console.error("usage: smoke.mjs <binary> <reference-dir> [--label <name>]");
  process.exit(2);
}

const binary = resolve(binaryArgument);
const referenceDirectory = resolve(referenceArgument);
const environment = { ...process.env, ...JSON.parse(process.env.SMOKE_ENV ?? "{}") };
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "seampact-smoke-")));

// The first run of the file on this runner includes any OS scan of it.
const firstStarted = process.hrtime.bigint();

spawnSync(binary, ["help"], { env: environment, stdio: "ignore" });

const firstLaunchMs = Number(process.hrtime.bigint() - firstStarted) / 1e6;

for (const app of SMOKE_APPS) {
  const directory = join(scratch, app.name);

  writeSmokeApp(app, directory);

  const { steps, irFiles } = runSmokeApp({ executable: binary, environment, app, directory });

  const referenceSteps = JSON.parse(
    readFileSync(join(referenceDirectory, app.name, "steps.json"), "utf8"),
  );

  check(
    JSON.stringify(steps) === JSON.stringify(referenceSteps),
    `${app.name}: command answers differ from the Node CLI:\n${JSON.stringify(steps)}\n${JSON.stringify(referenceSteps)}`,
  );

  for (const file of irFileNames) {
    const reference = readFileSync(join(referenceDirectory, app.name, file));

    check(
      Buffer.compare(irFiles[file], reference) === 0,
      `${app.name}/${file} differs from the Node CLI IR`,
    );
  }
}

// `generate` is the one command the binary refuses by name.
const generate = spawnSync(binary, ["generate"], {
  cwd: join(scratch, SMOKE_APPS[0].name),
  env: environment,
  encoding: "utf8",
});

check(generate.status === 2, `generate exited ${generate.status}, not 2`);
check(
  generate.stderr.startsWith("binary.generate-unavailable: ") && generate.stderr.includes("Fix: "),
  `generate did not refuse by name with a fix: ${generate.stderr}`,
);

// Measures (recorded, not gated): size, the first launch and the warm start, the median of 7 further runs of `help`.
const warmRuns = [];

for (let run = 0; run < 7; run++) {
  const started = process.hrtime.bigint();

  spawnSync(binary, ["help"], { env: environment, stdio: "ignore" });
  warmRuns.push(Number(process.hrtime.bigint() - started) / 1e6);
}

warmRuns.sort((a, b) => a - b);

const row = {
  label,
  sizeMiB: +(statSync(binary).size / 1048576).toFixed(1),
  firstLaunchMs: +firstLaunchMs.toFixed(0),
  warmMs: +warmRuns[3].toFixed(0),
  pass: failures.length === 0,
};

console.log(JSON.stringify(row));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| ${label} | ${row.pass ? "pass" : "FAIL"} | ${row.sizeMiB} | ${row.firstLaunchMs} | ${row.warmMs} |\n`,
  );
}

rmSync(scratch, { recursive: true, force: true });

for (const failure of failures) console.error(`smoke: ${failure}`);

process.exit(failures.length === 0 ? 0 : 1);
