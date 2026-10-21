// The apps the reference run and the smoke run the CLI on: the reference contract, and one contract per first-party
// pack that has a golden contract (it names its pack, which the binary resolves from the packs it embeds).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export const irFileNames = APIS.map((api) => `${api}.ir.json`);

// Writes the app (config and a copy of the contract) into `directory`.
export function writeSmokeApp(app, directory) {
  mkdirSync(directory, { recursive: true });
  cpSync(join(repositoryRoot, app.contract), join(directory, CONTRACT_DIRECTORY), {
    recursive: true,
  });
  writeFileSync(join(directory, "seampact.config.yaml"), APP_CONFIG);
}

const IR_DIRECTORY = "ir";

// What the commands the binary shares with the Node CLI answer: exit code and both streams, with the app's
// directory replaced since it differs between runs.
const APP_STEPS = [
  ["compile", "--out", IR_DIRECTORY],
  ["lint"],
  ["diff", "--against", IR_DIRECTORY],
];
const GLOBAL_STEPS = [["help"], ["init"], ["bundle"], ["explain"]];

// The commands the binary refuses by name (`binary-refusals.ts`); the Node CLI lists them in `help` and in the
// not-available fix, so the smoke derives the binary's expected answer from the reference.
export const BINARY_REFUSED_COMMANDS = ["generate", "check"];

// Runs every shared step with `executable` (`prefixArguments` first) in the app directory; the result holds the
// answers and the bytes of each IR file `compile` wrote.
export function runSmokeApp({ executable, prefixArguments = [], environment, app, directory }) {
  const answer = (commandArguments) => {
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

  const steps = {};

  for (const step of APP_STEPS) steps[step.join(" ")] = answer(step);

  if (app.name === SMOKE_APPS[0].name) {
    for (const step of GLOBAL_STEPS) steps[step.join(" ")] = answer(step);
  }

  const irFiles = Object.fromEntries(
    irFileNames.map((file) => [file, readFileSync(join(directory, IR_DIRECTORY, file))]),
  );

  return { steps, irFiles };
}

function withoutDirectory(text, directory) {
  // A Windows path prints its separators as backslashes.
  return text.split(directory).join("<app>").replaceAll("<app>\\", "<app>/");
}
