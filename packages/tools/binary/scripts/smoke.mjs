// Runs one binary on the smoke apps and compares it with the reference the Node CLI produced on Linux: the IR
// files, each app's bundle and its editor schemas byte for byte, and the answers of the commands both carry. The apps are copied outside the repository,
// so a pack can only come from the packs embedded in the binary.
// Usage: node scripts/smoke.mjs <binary> <reference-dir> [--label <name>]
// Env: SMOKE_ENV='{"TZ":"Asia/Kolkata","LOG_TOKENS":"1"}' extra environment for the binary.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BINARY_REFUSED_COMMANDS,
  EDITOR_SCHEMAS_PREFIX,
  runSmokeApp,
  SMOKE_APPS,
  writeSmokeApp,
} from "./smoke-apps.mjs";

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

// The Node CLI's answers, less the commands the binary does not carry: its `help` and the not-available fix list
// only the binary's own commands.
function withoutRefusedCommands(referenceSteps) {
  const steps = structuredClone(referenceSteps);

  if (steps.help !== undefined) {
    steps.help.stdout = steps.help.stdout
      .split("\n")
      .filter(
        (line) => !BINARY_REFUSED_COMMANDS.some((command) => line.startsWith(`  ${command} `)),
      )
      .join("\n");
  }

  if (steps.init !== undefined) {
    steps.init.stderr = steps.init.stderr.replace(
      "Use `seampact compile`, `generate`, `check`, `lint`, `diff`, `explain` or `bundle`.",
      "Use `seampact compile`, `lint`, `diff`, `explain` or `bundle`.",
    );
  }

  return steps;
}

for (const app of SMOKE_APPS) {
  const directory = join(scratch, app.name);

  writeSmokeApp(app, directory);

  const { steps, writtenFiles } = runSmokeApp({ executable: binary, environment, app, directory });

  const referenceSteps = JSON.parse(
    readFileSync(join(referenceDirectory, app.name, "steps.json"), "utf8"),
  );

  check(
    JSON.stringify(steps) === JSON.stringify(withoutRefusedCommands(referenceSteps)),
    `${app.name}: command answers differ from the Node CLI:\n${JSON.stringify(steps)}\n${JSON.stringify(withoutRefusedCommands(referenceSteps))}`,
  );

  const referenceFiles = referenceFileNames(join(referenceDirectory, app.name));

  check(
    JSON.stringify(Object.keys(writtenFiles).sort()) === JSON.stringify(referenceFiles),
    `${app.name}: the binary wrote ${Object.keys(writtenFiles).length} files, the Node CLI ${referenceFiles.length}`,
  );
  check(
    referenceFiles.some((file) => file.startsWith(EDITOR_SCHEMAS_PREFIX)),
    `${app.name}: compile --editor-schemas wrote no editor schema`,
  );

  for (const file of referenceFiles) {
    const reference = readFileSync(join(referenceDirectory, app.name, file));

    check(
      writtenFiles[file] !== undefined && Buffer.compare(writtenFiles[file], reference) === 0,
      `${app.name}/${file} differs from the Node CLI's`,
    );
  }
}

// The files the Node CLI wrote for one app, with forward slashes, sorted; `steps.json` holds its answers.
function referenceFileNames(appReference) {
  return readdirSync(appReference, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(appReference.length + 1))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file !== "steps.json")
    .sort();
}

for (const command of BINARY_REFUSED_COMMANDS) {
  const refused = spawnSync(binary, [command], {
    cwd: join(scratch, SMOKE_APPS[0].name),
    env: environment,
    encoding: "utf8",
  });

  check(refused.status === 2, `${command} exited ${refused.status}, not 2`);
  check(
    refused.stderr.startsWith(`binary.${command}-unavailable: `) &&
      refused.stderr.includes("Fix: "),
    `${command} did not refuse by name with a fix: ${refused.stderr}`,
  );
}

// The binary ignores `NODE_OPTIONS`: a `--require` there must not run inside it. The same variable given to this
// Node first proves the injected script runs where the variable is honoured.
function injectedScriptRuns(executable, args) {
  const marker = join(scratch, "injected.marker");
  const script = join(scratch, "inject.cjs");

  rmSync(marker, { force: true });
  writeFileSync(
    script,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "injected");\n`,
  );

  const nodeOptions = `--require "${script.replaceAll("\\", "/")}"`;

  spawnSync(executable, args, {
    env: { ...environment, NODE_OPTIONS: nodeOptions },
    stdio: "ignore",
  });

  return existsSync(marker);
}

check(
  injectedScriptRuns(process.execPath, ["--eval", ""]),
  "the NODE_OPTIONS probe did not run under Node itself, so it proves nothing",
);
check(
  !injectedScriptRuns(binary, ["help"]),
  "the binary ran a script NODE_OPTIONS asked it to --require",
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
