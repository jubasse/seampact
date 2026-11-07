import { type EmitOutcome, emitDocuments, parseEmitterOptions } from "@seampact/openapi";
import type { CheckLevel } from "@seampact/spec/config";
import { type CliProblem, problemFromRefusal } from "../cli-problem.js";
import { documentName, type PlannedDocument } from "./app-plan.js";
import type { Step } from "./step.js";

// One document's text, rendered in memory before anything is written; `level` is the `checks.openapi` that governs
// its drift.
export interface EmittedDocument {
  name: string;
  file: string;
  text: string;
  level: CheckLevel;
}

// Each planned document rendered by the OpenAPI emitter with its options; an api is emitted once per set of options.
export function emitAppDocuments(
  documents: readonly PlannedDocument[],
  level: CheckLevel,
): Step<EmittedDocument[]> {
  const emittedApis = new Map<string, EmitOutcome>();
  const emitted: EmittedDocument[] = [];
  const problems: CliProblem[] = [];

  for (const { planned, ir } of documents) {
    const name = documentName(planned);
    const where = `openapi document '${name}' (${planned.file})`;
    const options = parseEmitterOptions(structuredClone(planned.options));

    if (options.status === "refused") {
      problems.push(...options.refusals.map((refusal) => problemFromRefusal(refusal, where)));
      continue;
    }

    const key = JSON.stringify([
      planned.source,
      planned.api,
      planned.servedOperations ?? null,
      options.options,
    ]);
    const outcome = emittedApis.get(key) ?? emitDocuments(ir, options.options);

    emittedApis.set(key, outcome);

    if (outcome.status === "refused") {
      problems.push(...outcome.refusals.map((refusal) => problemFromRefusal(refusal, where)));
      continue;
    }

    const document = outcome.documents.find((each) => each.name === planned.document);

    if (document === undefined) throw new Error(`the emitter wrote no document ${name}`);

    emitted.push({ name, file: planned.file, text: document.text, level });
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: emitted };
}
