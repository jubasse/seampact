import { dirname } from "node:path";
import type { PlanWriteOptions } from "@seampact/codegen-core";
import type { CliIo } from "../cli-io.js";
import { type CliProblem, inApp } from "../cli-problem.js";
import { type LoadedAppConfig, type LoadedWorkspace, readRunConfig } from "../config/index.js";
import { type AppPlan, planApp } from "./app-plan.js";
import type { ConfigLocation } from "./config-location.js";
import { type EmittedDocument, emitAppDocuments } from "./document-emission.js";
import { DEFAULT_DRIFT_CHECK_LEVEL } from "./drift-level.js";
import { type GeneratedOutput, generateEntries } from "./entry-generation.js";
import { emitMergedDocuments } from "./merged-documents.js";
import {
  type NativeEntryPolicy,
  npmEntryProblems,
  REFUSE_NATIVE_ENTRIES,
} from "./native-entries.js";
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
// is every write, checked, for `generate` to commit and `check` to compare. `nativeEntries` says what becomes of an
// entry a build plugin generates.
export async function prepareRun(
  location: ConfigLocation,
  io: CliIo,
  writeOptions: PlanWriteOptions = REFUSE_HAND_EDITS,
  nativeEntries: NativeEntryPolicy = REFUSE_NATIVE_ENTRIES,
): Promise<Step<PlannedWrites>> {
  const read = await readRunConfig(location.file, location.displayName);

  if (read.status === "refused") return read;

  const run: RunOptions = { io, writeOptions, nativeEntries };

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
  nativeEntries: NativeEntryPolicy;
}

async function prepareApps(
  apps: readonly RunApp[],
  workspace: LoadedWorkspace | undefined,
  { io, writeOptions, nativeEntries }: RunOptions,
): Promise<Step<PlannedWrites>> {
  const npmEntries = apps.flatMap((app) =>
    scoped(app, npmEntryProblems(app.config, nativeEntries)),
  );

  if (npmEntries.length > 0) return { status: "refused", problems: npmEntries };

  const plans = await planEachApp(apps, io, nativeEntries);

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
  nativeEntries: NativeEntryPolicy,
): Promise<Step<PlannedApp[]>> {
  const planned: PlannedApp[] = [];
  const problems: CliProblem[] = [];
  let anyRefused = false;

  for (const app of apps) {
    const plan = await planApp(app.config, io, nativeEntries);

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
