// The apps the reference run and the smoke run the CLI on: the reference contract, and one contract per first-party
// pack that has a golden contract (it names its pack, which the binary resolves from the packs it embeds).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const CONTRACT_DIRECTORY = "contract";
const APIS = ["tasks", "tasksService"];

export const SMOKE_APPS = [
  { name: "reference", contract: "fixtures/reference" },
  { name: "pack-api-platform", contract: "fixtures/golden/pack-api-platform/contract" },
  { name: "pack-crud-rights", contract: "fixtures/golden/pack-crud-rights/contract" },
  { name: "pack-hal", contract: "fixtures/golden/pack-hal/contract" },
  { name: "pack-laravel", contract: "fixtures/golden/pack-laravel/contract" },
  { name: "pack-spring", contract: "fixtures/golden/pack-spring/contract" },
];

// `compile` reads the sources the app config's targets use; the target package itself is never loaded.
const APP_CONFIG = `sources:
  contract: { path: ./${CONTRACT_DIRECTORY} }
targets:
  - { id: server, use: seampact-smoke-target, apis: [${APIS.join(", ")}] }
`;

const irFileNames = APIS.map((api) => `${api}.ir.json`);
const BUNDLE_FILE = "contract.seampact.tgz";

// The files both runs write and the smoke compares byte for byte: each IR file, the bundle tarball, which is
// reproducible (ADR 0011) and vendors the same pack files whether the pack is linked or embedded, and the editor
// schemas `compile --editor-schemas` writes, keyed under this prefix.
export const EDITOR_SCHEMAS_PREFIX = "editor-schemas/";

const EDITOR_SCHEMAS_DIRECTORY = join(CONTRACT_DIRECTORY, ".seampact", "schemas");

// Writes the app (config and a copy of the contract) into `directory`.
export function writeSmokeApp(app, directory) {
  mkdirSync(directory, { recursive: true });
  cpSync(join(repositoryRoot, app.contract), join(directory, CONTRACT_DIRECTORY), {
    recursive: true,
  });
  writeFileSync(join(directory, "seampact.config.yaml"), APP_CONFIG);
}

const IR_DIRECTORY = "ir";

// The runs of `init` in an empty folder: the project it writes, then `compile` on it; the smoke compares every file
// the run leaves.
export const INIT_RUNS = [
  { name: "init", steps: [["init"], ["compile"], ["init", "--modelines"]] },
  { name: "init-blank", steps: [["init", "--blank"], ["compile"]] },
];

// What the commands the binary shares with the Node CLI answer: exit code and both streams, with the app's
// directory replaced since it differs between runs.
const APP_STEPS = [
  ["compile", "--out", IR_DIRECTORY],
  ["compile", "--editor-schemas"],
  ["lint"],
  ["diff", "--against", IR_DIRECTORY],
  ["bundle", "--tarball", BUNDLE_FILE, "--name", "@seampact-smoke/contract", "--version", "1.0.0"],
];
const GLOBAL_STEPS = [["help"], ["init"], ["explain", "tasks.updateTask"]];

// The commands the binary refuses by name (`binary-refusals.ts`); the Node CLI lists them in `help` and in the
// not-available fix, so the smoke derives the binary's expected answer from the reference.
export const BINARY_REFUSED_COMMANDS = ["generate", "check"];

// Runs every shared step with `executable` (`prefixArguments` first) in the app directory; the result holds the
// answers and the bytes of each compared file.
export function runSmokeApp({ executable, prefixArguments = [], environment, app, directory }) {
  const answer = answerIn({ executable, prefixArguments, environment, directory });

  const steps = {};

  for (const step of APP_STEPS) steps[step.join(" ")] = answer(step);

  if (app.name === SMOKE_APPS[0].name) {
    for (const step of GLOBAL_STEPS) steps[step.join(" ")] = answer(step);
  }

  const writtenFiles = Object.fromEntries([
    ...irFileNames.map((file) => [file, readFileSync(join(directory, IR_DIRECTORY, file))]),
    [BUNDLE_FILE, readFileSync(join(directory, BUNDLE_FILE))],
    ...editorSchemaFiles(join(directory, EDITOR_SCHEMAS_DIRECTORY)),
  ]);

  return { steps, writtenFiles };
}

// Runs one `init` run with `executable` in `directory`, created empty; the result holds the answers and the bytes
// of every file the run leaves, by path relative to the directory.
export function runInit({ executable, prefixArguments = [], environment, run, directory }) {
  mkdirSync(directory, { recursive: true });

  const answer = answerIn({ executable, prefixArguments, environment, directory });
  const steps = {};

  for (const step of run.steps) steps[step.join(" ")] = answer(step);

  const writtenFiles = Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .map((file) => [file.slice(directory.length + 1).replaceAll("\\", "/"), readFileSync(file)])
      .sort(([left], [right]) => (left < right ? -1 : 1)),
  );

  return { steps, writtenFiles };
}

// One command's answer in `directory`: exit code and both streams, the directory replaced since it differs
// between runs.
function answerIn({ executable, prefixArguments, environment, directory }) {
  return (commandArguments) => {
    const run = spawnSync(executable, [...prefixArguments, ...commandArguments], {
      cwd: directory,
      env: environment,
      encoding: "utf8",
    });

    return {
      status: run.status,
      stdout: withoutDirectory(run.stdout, directory),
      stderr: withoutDirectory(run.stderr, directory),
    };
  };
}

// Every file the editor schemas directory holds, in name order; none when the command wrote no directory.
function editorSchemaFiles(editorDirectory) {
  if (!existsSync(editorDirectory)) return [];

  return readdirSync(editorDirectory)
    .sort()
    .map((file) => [`${EDITOR_SCHEMAS_PREFIX}${file}`, readFileSync(join(editorDirectory, file))]);
}

function withoutDirectory(text, directory) {
  // A Windows path prints its separators as backslashes, in every segment under the app directory.
  return text
    .split(directory)
    .join("<app>")
    .replace(/<app>[^\s'"]*/g, (appPath) => appPath.replaceAll("\\", "/"));
}
