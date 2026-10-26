import { dirname } from "node:path";
import type { PlanWriteOptions } from "@seampact/codegen-core";
import type { CliIo } from "../cli-io.js";
import { type CliProblem, inApp } from "../cli-problem.js";
import { type LoadedAppConfig, type LoadedWorkspace, readRunConfig } from "../config/index.js";
import { type AppPlan, NODE_CLI_PLAN_INPUTS, type PlanInputs, planApp } from "./app-plan.js";
import type { ConfigLocation } from "./config-location.js";
import { type EmittedDocument, emitAppDocuments } from "./document-emission.js";
import { DEFAULT_DRIFT_CHECK_LEVEL } from "./drift-level.js";
import { type GeneratedOutput, generateEntries } from "./entry-generation.js";
import { emitMergedDocuments } from "./merged-documents.js";
import { npmEntryProblems } from "./native-entries.js";
import type { Step } from "./step.js";
import { type PlannedWrites, planWrites, type SweptDirectory } from "./write-plan.js";

const REFUSE_HAND_EDITS: PlanWriteOptions = { onHandEdit: "refuse" };

// One app of a run: its name in a root's `apps`, absent when the run is on one app's config.
interface RunApp {
  name?: string;
  config: LoadedAppConfig;
}

// Reads the config a command runs on, an app or a monorepo root, then plans and generates everything in memory:
// each app's entries and documents, and for a root the merged documents after them. Nothing is written; the result
// is every write, checked, for `generate` to commit and `check` to compare. `inputs` says what becomes of an entry a
// build plugin generates, and which bundles its host already fetched.
export async function prepareRun(
  location: ConfigLocation,
  io: CliIo,
  writeOptions: PlanWriteOptions = REFUSE_HAND_EDITS,
  inputs: PlanInputs = NODE_CLI_PLAN_INPUTS,
): Promise<Step<PlannedWrites>> {
  const read = await readRunConfig(location.file, location.displayName, location.textFile);

  if (read.status === "refused") return read;

  const configs =
    read.run.kind === "app"
      ? [read.run.config]
      : read.run.workspace.apps.map(({ config }) => config);
  const unknownBundles = unknownLocalBundleProblems(configs, inputs);

  if (unknownBundles.length > 0) return { status: "refused", problems: unknownBundles };

  const run: RunOptions = { io, writeOptions, inputs };

  if (read.run.kind === "app") return prepareApps([{ config: read.run.config }], undefined, run);

  const { workspace } = read.run;

  return prepareApps(
    workspace.apps.map(({ app, config }) => ({ name: app.name, config })),
    workspace,
    run,
  );
}

interface RunOptions {
  io: CliIo;
  writeOptions: PlanWriteOptions;
  inputs: PlanInputs;
}

// A local bundle names a bundle source of the config, never another source or none.
function unknownLocalBundleProblems(
  configs: readonly LoadedAppConfig[],
  inputs: PlanInputs,
): CliProblem[] {
  return [...inputs.localBundles.keys()]
    .filter((name) => !configs.some((config) => config.sources.get(name)?.kind === "bundle"))
    .map((name) => ({
      code: "cli.bundle-directory.unknown-source",
      message: `\`--bundle-directory\` names the source '${name}', which is no bundle source of the app config.`,
      fix: "Name a source the app config declares as a bundle (`release`, `git`, `package` or `maven`).",
    }));
}

async function prepareApps(
  apps: readonly RunApp[],
  workspace: LoadedWorkspace | undefined,
  { io, writeOptions, inputs }: RunOptions,
): Promise<Step<PlannedWrites>> {
  const npmEntries = apps.flatMap((app) =>
    scoped(app, npmEntryProblems(app.config, inputs.nativeEntries)),
  );

  if (npmEntries.length > 0) return { status: "refused", problems: npmEntries };

  const plans = await planEachApp(apps, io, inputs);

  if (plans.status === "refused") return plans;

  const outputs: GeneratedOutput[] = [];
  const documents: EmittedDocument[] = [];
  const problems: CliProblem[] = [];

  for (const { app, plan } of plans.value) {
    const generated = await generateEntries(plan, app.name);
    const emitted = emitAppDocuments(
      plan.documents,
      app.config.checks?.openapi ?? DEFAULT_DRIFT_CHECK_LEVEL,
    );

    if (generated.status === "refused") problems.push(...scoped(app, generated.problems));
    else outputs.push(...generated.value);

    if (emitted.status === "refused") problems.push(...scoped(app, emitted.problems));
    else documents.push(...emitted.value);
  }

  if (workspace !== undefined) {
    const merged = emitMergedDocuments(
      workspace,
      new Map(
        plans.value.flatMap(({ app, plan }) => (app.name === undefined ? [] : [[app.name, plan]])),
      ),
    );

    if (merged.status === "refused") problems.push(...merged.problems);
    else documents.push(...merged.value);
  }

  if (problems.length > 0) return { status: "refused", problems };

  const swept: SweptDirectory[] = plans.value.map(({ app, plan }) => ({
    directory: plan.defaultDocumentDirectory,
    level: app.config.checks?.openapi ?? DEFAULT_DRIFT_CHECK_LEVEL,
  }));

  // A merged document dropped from the root's `openapi` leaves its file in the root's directory.
  if (workspace !== undefined) {
    swept.push({
      directory: dirname(workspace.root.file),
      level: workspace.root.checks.openapi ?? DEFAULT_DRIFT_CHECK_LEVEL,
    });
  }

  return { status: "done", value: await planWrites(outputs, documents, swept, writeOptions) };
}

interface PlannedApp {
  app: RunApp;
  plan: AppPlan;
}

// Every app planned, the problems of every app reported together. An app refused with no problem (its compile
// diagnostics are already printed) still refuses the run.
async function planEachApp(
  apps: readonly RunApp[],
  io: CliIo,
  inputs: PlanInputs,
): Promise<Step<PlannedApp[]>> {
  const planned: PlannedApp[] = [];
  const problems: CliProblem[] = [];
  let anyRefused = false;

  for (const app of apps) {
    const plan = await planApp(app.config, io, inputs);

    if (plan.status === "refused") {
      anyRefused = true;
      problems.push(...scoped(app, plan.problems));
    } else planned.push({ app, plan: plan.value });
  }

  return anyRefused ? { status: "refused", problems } : { status: "done", value: planned };
}

function scoped(app: RunApp, problems: readonly CliProblem[]): CliProblem[] {
  const { name } = app;

  return name === undefined ? [...problems] : problems.map((problem) => inApp(name, problem));
}
