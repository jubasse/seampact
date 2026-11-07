import { type MergeInput, mergeDocuments, parseEmitterOptions } from "@seampact/openapi";
import { type CliProblem, problemFromRefusal } from "../cli-problem.js";
import {
  type LoadedWorkspace,
  type MergedContribution,
  type PlannedMergedDocument,
  planMergedDocuments,
} from "../config/index.js";
import { parseApiRef } from "./api-refs.js";
import { type AppPlan, servedIr } from "./app-plan.js";
import type { EmittedDocument } from "./document-emission.js";
import { DEFAULT_DRIFT_CHECK_LEVEL } from "./drift-level.js";
import type { Step } from "./step.js";

// The merged documents of a root config (ADR 0011 "Which OpenAPI documents exist"), each written from the apis its
// apps contribute, in memory. `plans` holds each app's plan by the app's name in `apps`.
export function emitMergedDocuments(
  workspace: LoadedWorkspace,
  plans: ReadonlyMap<string, AppPlan>,
): Step<EmittedDocument[]> {
  const rolesByApp = new Map([...plans].map(([app, plan]) => [app, plan.roles]));
  const plan = planMergedDocuments(workspace, rolesByApp);

  if (plan.status === "refused") return plan;

  const level = workspace.root.checks.openapi ?? DEFAULT_DRIFT_CHECK_LEVEL;
  const emitted: EmittedDocument[] = [];
  const problems: CliProblem[] = [];

  for (const planned of plan.documents) {
    const text = mergedText(planned, plans);

    if (text.status === "refused") problems.push(...text.problems);
    else emitted.push({ name: planned.name, file: planned.file, text: text.value, level });
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: emitted };
}

function mergedText(
  planned: PlannedMergedDocument,
  plans: ReadonlyMap<string, AppPlan>,
): Step<string> {
  const where = `merged openapi document '${planned.name}' (${planned.file})`;
  const options = parseEmitterOptions(structuredClone(planned.options));

  if (options.status === "refused") {
    return {
      status: "refused",
      problems: options.refusals.map((refusal) => problemFromRefusal(refusal, where)),
    };
  }

  const inputs: MergeInput[] = [];
  const problems: CliProblem[] = [];

  for (const contribution of planned.contributions) {
    const input = mergeInput(contribution, plans);

    if (input.status === "refused")
      problems.push(...input.problems.map((problem) => ({ ...problem, where })));
    else inputs.push(input.value);
  }

  if (problems.length > 0) return { status: "refused", problems };

  const merged = mergeDocuments(inputs, {
    name: planned.name,
    prefix: structuredClone(planned.prefix),
    emitter: options.options,
  });

  if (merged.status === "refused") {
    return {
      status: "refused",
      problems: merged.refusals.map((refusal) => problemFromRefusal(refusal, where)),
    };
  }

  return { status: "done", value: merged.text };
}

// The api of one contribution as its app compiled it, narrowed to the operations the contribution keeps.
function mergeInput(
  contribution: MergedContribution,
  plans: ReadonlyMap<string, AppPlan>,
): Step<MergeInput> {
  const plan = plans.get(contribution.app);

  if (plan === undefined) throw new Error(`no plan for the app ${contribution.app}`);

  const { source, api } = parseApiRef(contribution.api);
  const found = plan.compiled.find(
    (each) => each.api === api && (source === undefined || each.source === source),
  );

  if (found === undefined)
    throw new Error(`the app ${contribution.app} compiled no api ${contribution.api}`);

  const served = servedIr(
    found.ir,
    contribution.operations === undefined ? undefined : [contribution.operations],
  );

  if (served.status === "refused") return served;

  return {
    status: "done",
    value: {
      ir: served.value,
      ...(contribution.document === undefined ? {} : { document: contribution.document }),
    },
  };
}
