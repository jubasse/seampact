import type { NativeDocsDocument, NativeDocsJson } from "@seampact/codegen-core";
import {
  DEFAULT_EMITTER_OPTIONS,
  type EmitterOptions,
  emitDocuments,
  parseEmitterOptions,
} from "@seampact/openapi";
import type { TargetEntry } from "@seampact/spec/config";
import { parse } from "yaml";
import { type CliProblem, entryWhere, problemFromRefusal } from "../cli-problem.js";
import type { PlannedAppDocument } from "../config/index.js";
import { isRecord } from "../is-record.js";
import type { PlannedApi } from "./entry-links.js";
import { isInDocument } from "./filter-operations.js";

// The seampact OpenAPI document the `nativeDocs` artefact of one entry and api follows (ADR 0011 "Which OpenAPI
// documents exist"): the document the entry names, else the one document that holds every route the entry
// generates, emitted from the entry's own IR with the options the app gives the same document, else the defaults.

export type NativeDocsDocumentOutcome =
  | { status: "done"; value: NativeDocsDocument }
  | { status: "refused"; problems: CliProblem[] };

export function nativeDocsDocumentOf(
  entry: TargetEntry,
  plannedApi: PlannedApi,
  appDocuments: readonly PlannedAppDocument[],
): NativeDocsDocumentOutcome {
  const where = entryWhere(entry.id, plannedApi.api);
  const chosen = chosenDocumentName(entry, plannedApi, where);

  if (chosen.status === "refused") return chosen;

  const options = emitterOptionsOf(plannedApi, chosen.name, appDocuments, where);

  if (options.status === "refused") return options;

  const emitted = emitDocuments(plannedApi.ir, options.options);

  if (emitted.status === "refused") {
    return {
      status: "refused",
      problems: emitted.refusals.map((refusal) => problemFromRefusal(refusal, where)),
    };
  }

  const document = emitted.documents.find((each) => each.name === chosen.name);
  const parsed: NativeDocsJson | undefined =
    document === undefined ? undefined : parse(document.text);

  if (document === undefined || !isRecord(parsed)) {
    throw new Error(`the emitter wrote no document ${chosen.name ?? plannedApi.api} as an object`);
  }

  return {
    status: "done",
    value: {
      ...(chosen.name === undefined ? {} : { name: chosen.name }),
      document: parsed,
    },
  };
}

type ChosenName =
  | { status: "chosen"; name?: string }
  | { status: "refused"; problems: CliProblem[] };

function chosenDocumentName(entry: TargetEntry, plannedApi: PlannedApi, where: string): ChosenName {
  if (entry.document !== undefined) return { status: "chosen", name: entry.document };

  const declared = Object.keys(plannedApi.ir.api.documents);

  if (declared.length === 0) return { status: "chosen" };

  const holdingEveryRoute = declared.filter((id) =>
    plannedApi.ir.operations.every((operation) => isInDocument(plannedApi.ir, id, operation)),
  );
  const [only] = holdingEveryRoute;

  if (holdingEveryRoute.length === 1 && only !== undefined) return { status: "chosen", name: only };

  return {
    status: "refused",
    problems: [ambiguousDocumentProblem(declared, holdingEveryRoute, where)],
  };
}

function ambiguousDocumentProblem(
  declared: readonly string[],
  holdingEveryRoute: readonly string[],
  where: string,
): CliProblem {
  const why =
    holdingEveryRoute.length === 0
      ? `none of them holds every route the entry generates`
      : `${quoted(holdingEveryRoute)} each hold every route the entry generates`;

  return {
    code: "nativeDocs.document.ambiguous",
    message: `The api declares the documents ${quoted(declared)}; ${why}, so the framework's document cannot follow one of them.`,
    fix: `Set \`document\` on the entry to the document the framework's document describes (${quoted(holdingEveryRoute.length === 0 ? declared : holdingEveryRoute)}), or drop \`nativeDocs\`.`,
    where,
  };
}

function quoted(ids: readonly string[]): string {
  return ids.map((id) => `'${id}'`).join(", ");
}

type EmitterOptionsOutcome =
  | { status: "parsed"; options: EmitterOptions }
  | { status: "refused"; problems: CliProblem[] };

// The options of the app's document for the same api and document name; `servers` stay the framework's own.
function emitterOptionsOf(
  plannedApi: PlannedApi,
  name: string | undefined,
  appDocuments: readonly PlannedAppDocument[],
  where: string,
): EmitterOptionsOutcome {
  const placed = appDocuments.find(
    (each) =>
      each.source === plannedApi.source && each.api === plannedApi.api && each.document === name,
  );

  if (placed === undefined) return { status: "parsed", options: DEFAULT_EMITTER_OPTIONS };

  const parsed = parseEmitterOptions(structuredClone(placed.options));

  if (parsed.status === "refused") {
    return {
      status: "refused",
      problems: parsed.refusals.map((refusal) => problemFromRefusal(refusal, where)),
    };
  }

  return { status: "parsed", options: { ...parsed.options, servers: [] } };
}
