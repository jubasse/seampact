import type { TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import type { LoadedAppConfig, ResolvedSource } from "../config/index.js";
import type { CompiledApi } from "./compile-sources.js";
import { workspaceApiNames } from "./workspace-api-names.js";

// An entry's `api` or `apis` item: the api's name alone, or `<source>/<api>` (ADR 0011).
export interface ApiRef {
  source?: string;
  api: string;
}

const SOURCE_SEPARATOR = "/";

export function parseApiRef(text: string): ApiRef {
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

// The sources the targets and `extraRefs` (the apis an `openapi` key names) use: each source a `<source>/<api>`
// names and, for an api named alone, each source that may hold it (see `sourcesHoldingRefs`).
export async function usedSources(
  config: LoadedAppConfig,
  extraRefs: readonly string[],
): Promise<UsedSourcesOutcome> {
  const problems = unknownSourceProblems(config);

  if (problems.length > 0) return { status: "refused", problems };

  return {
    status: "used",
    names: await sourcesHoldingRefs(config, [...entryApiRefs(config), ...extraRefs]),
  };
}

// Each `<source>/<api>` of a target entry whose source the app config does not define.
export function unknownSourceProblems(config: LoadedAppConfig): CliProblem[] {
  return config.entries.flatMap(({ entry }) =>
    apiRefsOf(entry)
      .map(parseApiRef)
      .filter((ref) => ref.source !== undefined && !config.sources.has(ref.source))
      .map((ref) => ({
        code: "config.api.unknown-source",
        message: `The app config has no source '${ref.source}' (${[...config.sources.keys()].join(", ") || "none"}).`,
        fix: "Name one of the app config's `sources` before the '/', or add the source.",
        where: entryWhere(entry.id, ref.api),
      })),
  );
}

export function entryApiRefs(config: LoadedAppConfig): string[] {
  return config.entries.flatMap(({ entry }) => apiRefsOf(entry));
}

// The sources `refs` use (ADR 0011: a source no ref uses is never resolved): the source each `<source>/<api>`
// names and, for an api named alone, each source that may hold it: a `path` source whose `workspace.yaml` lists
// it or cannot be read (its compile then says why), and every bundle source, whose apis only its manifest tells.
export async function sourcesHoldingRefs(
  config: LoadedAppConfig,
  refs: readonly string[],
): Promise<string[]> {
  const parsed = refs.map(parseApiRef);
  const bareApis = new Set(parsed.flatMap((ref) => (ref.source === undefined ? [ref.api] : [])));
  const named = new Set(parsed.flatMap((ref) => (ref.source === undefined ? [] : [ref.source])));
  const used: string[] = [];

  for (const [name, source] of config.sources) {
    if (named.has(name) || (bareApis.size > 0 && (await mayHoldAny(source, bareApis))))
      used.push(name);
  }

  return used;
}

async function mayHoldAny(source: ResolvedSource, apis: ReadonlySet<string>): Promise<boolean> {
  if (source.kind === "bundle") return true;

  const names = await workspaceApiNames(source.directory);

  return names === undefined || names.some((name) => apis.has(name));
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

// A source that fails only because an api is named alone is fetched for it: naming the api `<source>/<api>` leaves
// the other sources unfetched, which the fix says.
export function addQualifyFix(
  problems: readonly CliProblem[],
  refs: readonly string[],
): CliProblem[] {
  const named = new Set(refs.flatMap((ref) => parseApiRef(ref).source ?? []));
  const bareRefs = refs.filter((ref) => parseApiRef(ref).source === undefined);

  return problems.map((problem) => {
    const source = /^source '([^']+)'/.exec(problem.where ?? "")?.[1];

    if (source === undefined || named.has(source) || bareRefs.length === 0) return problem;

    return {
      ...problem,
      fix: `${problem.fix} The source is read because an api is named alone (${bareRefs.map((ref) => `'${ref}'`).join(", ")}); name each as \`<source>/<api>\` and only that source is read.`,
    };
  });
}
