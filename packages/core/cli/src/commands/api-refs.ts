import type { TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import type { LoadedAppConfig } from "../config/index.js";
import type { CompiledApi } from "./compile-sources.js";

// An entry's `api` or `apis` item: the api's name alone, or `<source>/<api>` (ADR 0011).
interface ApiRef {
  source?: string;
  api: string;
}

const SOURCE_SEPARATOR = "/";

function parseApiRef(text: string): ApiRef {
  const separator = text.indexOf(SOURCE_SEPARATOR);

  if (separator === -1) return { api: text };

  return { source: text.slice(0, separator), api: text.slice(separator + 1) };
}

export function apiRefsOf(entry: TargetEntry): string[] {
  return entry.apis ?? (entry.api === undefined ? [] : [entry.api]);
}

export type UsedSourcesOutcome =
  | { status: "used"; names: string[] }
  | { status: "refused"; problems: CliProblem[] };

// The sources the targets use: each source an `api` names, or every source when one names an api alone, since
// only the compiled sources tell where that api lives.
export function usedSources(config: LoadedAppConfig): UsedSourcesOutcome {
  const refs = config.entries.flatMap(({ entry }) =>
    apiRefsOf(entry).map((text) => ({ entry, ref: parseApiRef(text) })),
  );

  const problems = refs
    .filter(({ ref }) => ref.source !== undefined && !config.sources.has(ref.source))
    .map(({ entry, ref }) => ({
      code: "config.api.unknown-source",
      message: `The app config has no source '${ref.source}' (${[...config.sources.keys()].join(", ") || "none"}).`,
      fix: "Name one of the app config's `sources` before the '/', or add the source.",
      where: entryWhere(entry.id, ref.api),
    }));

  if (problems.length > 0) return { status: "refused", problems };

  if (refs.some(({ ref }) => ref.source === undefined))
    return { status: "used", names: [...config.sources.keys()] };

  return {
    status: "used",
    names: [...new Set(refs.flatMap(({ ref }) => (ref.source === undefined ? [] : [ref.source])))],
  };
}

export type EntryApisOutcome =
  | { status: "resolved"; apis: CompiledApi[] }
  | { status: "refused"; problems: CliProblem[] };

// ADR 0011 places each api under `<out>/<api>`, so two items of one entry cannot share an api name.
function duplicateApiProblem(entry: TargetEntry, text: string, found: CompiledApi): CliProblem {
  const items = apiRefsOf(entry).filter((each) => parseApiRef(each).api === found.api);

  return {
    code: "config.api.duplicate",
    message: `The entry '${entry.id}' names the api '${found.api}' more than once (${items.map((each) => `'${each}'`).join(", ")}); '${text}' is one of them.`,
    fix: `Keep one of them, or give the sources' apis different names.`,
    where: entryWhere(entry.id, found.api),
  };
}

// The compiled apis an entry names: an api named alone must be the only one of that name among the sources.
export function resolveEntryApis(
  entry: TargetEntry,
  compiled: readonly CompiledApi[],
): EntryApisOutcome {
  const apis: CompiledApi[] = [];
  const problems: CliProblem[] = [];

  for (const text of apiRefsOf(entry)) {
    const ref = parseApiRef(text);
    const candidates = compiled.filter(
      (each) => each.api === ref.api && (ref.source === undefined || each.source === ref.source),
    );
    const [found] = candidates;

    if (candidates.length > 1) {
      problems.push({
        code: "config.api.ambiguous",
        message: `The api '${ref.api}' exists in the sources ${candidates.map((each) => `'${each.source}'`).join(", ")}.`,
        fix: `Name it as \`<source>/${ref.api}\`.`,
        where: entryWhere(entry.id, ref.api),
      });
    } else if (found === undefined) {
      problems.push({
        code: "config.api.unknown",
        message: `No source of the app config holds an api '${text}'.`,
        fix: "Name an api of a source's `workspace.yaml`, as `<api>` or `<source>/<api>`.",
        where: entryWhere(entry.id, ref.api),
      });
    } else if (apis.some((each) => each.api === found.api)) {
      problems.push(duplicateApiProblem(entry, text, found));
    } else {
      apis.push(found);
    }
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "resolved", apis };
}
