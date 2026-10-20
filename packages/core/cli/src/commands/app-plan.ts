import { join } from "node:path";
import type { Target, TargetRole } from "@seampact/codegen-core";
import type { OperationsFilter, TargetEntry } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import { type CliIo, printWarnings } from "../cli-io.js";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import {
  checkAppCompatibility,
  defaultDocumentDirectory,
  type LoadedAppConfig,
  openApiApiNames,
  type PlannedAppDocument,
  planAppDocuments,
  resolveTarget,
  selectArtefacts,
} from "../config/index.js";
import {
  addQualifyFix,
  entryApiRefs,
  resolveEntryApis,
  sourcesHoldingRefs,
  unknownSourceProblems,
} from "./api-refs.js";
import { type CompiledApi, compileSources } from "./compile-sources.js";
import {
  orderEntries,
  type PlannedApi,
  type PlannedEntry,
  pairingProblems,
  unconsumedKindProblems,
  unknownLinkEntryProblems,
  unprovidedKindProblems,
} from "./entry-links.js";
import { filterOperations } from "./filter-operations.js";
import { frameworkDocsProblems } from "./framework-docs.js";
import { unreadFrameworkRouteKeyProblems } from "./framework-route-check.js";
import type { Step } from "./step.js";

// One seampact OpenAPI document of the app, with the compiled IR of its api.
export interface PlannedDocument {
  planned: PlannedAppDocument;
  ir: ContractIR;
}

// Everything one app's run knows before a target generates: its entries in link order with their apis, the
// artefacts each entry generates (by entry id), its documents, and the compiled apis.
export interface AppPlan {
  config: LoadedAppConfig;
  entries: PlannedEntry[];
  artefacts: ReadonlyMap<string, ReadonlySet<string>>;
  documents: PlannedDocument[];
  // Where the app's default documents go: a document seampact wrote there and the config dropped is removed.
  defaultDocumentDirectory: string;
  compiled: readonly CompiledApi[];
  // The role of each entry's target, by entry id.
  roles: ReadonlyMap<string, TargetRole>;
}

// Plans one app's run: resolves each target from the app's project, checks the artefact switches and the
// compatibility matrix, compiles the sources the targets and the `openapi` key use, keeps each entry's operations
// and checks the links (ADR 0009, ADR 0011).
export async function planApp(config: LoadedAppConfig, io: CliIo): Promise<Step<AppPlan>> {
  const entries = config.entries.map(({ entry }) => entry);
  const unknownLinks = unknownLinkEntryProblems(entries);

  if (unknownLinks.length > 0) return { status: "refused", problems: unknownLinks };

  const ordered = orderEntries(entries);

  if (ordered.status === "refused") return ordered;

  const targets = await resolveTargets(config);

  if (targets.status === "refused") return targets;

  const artefacts = selectEntryArtefacts(config, targets.value);
  const compatibility = checkAppCompatibility(config, targets.value);

  printWarnings(io, compatibility.warnings);

  const configProblems = [
    ...(artefacts.status === "refused" ? artefacts.problems : []),
    ...compatibility.problems,
  ];

  if (artefacts.status === "refused" || configProblems.length > 0) {
    return { status: "refused", problems: configProblems };
  }

  const unknownSources = unknownSourceProblems(config);

  if (unknownSources.length > 0) return { status: "refused", problems: unknownSources };

  const refs = [...entryApiRefs(config), ...openApiApiNames(config)];
  const sourceNames = await sourcesHoldingRefs(config, refs);
  const compiled = await compileSources(config, sourceNames, io);

  if (compiled.failed)
    return { status: "refused", problems: addQualifyFix(compiled.problems, refs) };

  const planned = planEachEntry(config, targets.value, compiled.apis);

  if (planned.status === "refused") return planned;

  const linkProblems = [
    ...unprovidedKindProblems(planned.value),
    ...unconsumedKindProblems(planned.value),
    ...pairingProblems(planned.value),
  ];

  if (linkProblems.length > 0) return { status: "refused", problems: linkProblems };

  const documents = planDocuments(config, targets.value, compiled.apis);

  if (documents.status === "refused") return documents;

  return {
    status: "done",
    value: {
      config,
      entries: ordered.entries.map((entry) => plannedEntry(planned.value, entry.id)),
      artefacts: artefacts.value,
      documents: documents.value,
      defaultDocumentDirectory: defaultDocumentDirectory(config),
      compiled: compiled.apis,
      roles: new Map(
        [...targets.value].map(([entryId, target]) => [entryId, target.metadata.role]),
      ),
    },
  };
}

// The app's documents (A43), each with the compiled IR of its api.
function planDocuments(
  config: LoadedAppConfig,
  targets: ReadonlyMap<string, Target>,
  compiled: readonly CompiledApi[],
): Step<PlannedDocument[]> {
  const roles = new Map([...targets].map(([entryId, target]) => [entryId, target.metadata.role]));
  const apiDocuments = compiled.map(({ source, api, ir }) => ({
    source,
    api,
    documents: Object.keys(ir.api.documents),
  }));
  const plan = planAppDocuments(config, roles, apiDocuments);

  if (plan.status === "refused") return plan;

  const documents: PlannedDocument[] = [];
  const problems: CliProblem[] = [];

  for (const planned of plan.documents) {
    const served = servedIr(compiledIr(compiled, planned), planned.servedOperations);

    if (served.status === "refused") {
      problems.push(
        ...served.problems.map((problem) => ({
          ...problem,
          where: `openapi document '${documentName(planned)}'`,
        })),
      );
    } else {
      documents.push({ planned, ir: served.value });
    }
  }

  return problems.length > 0
    ? { status: "refused", problems }
    : { status: "done", value: documents };
}

// The api's IR with the operations its server entries keep: the union of each entry's `operations`.
export function servedIr(
  ir: ContractIR,
  servedOperations: readonly OperationsFilter[] | undefined,
): Step<ContractIR> {
  if (servedOperations === undefined) return { status: "done", value: ir };

  const keptIds = new Set<string>();

  for (const operations of servedOperations) {
    const filtered = filterOperations(ir, { operations });

    if (filtered.status === "refused") return filtered;

    for (const operation of filtered.ir.operations) keptIds.add(operation.id);
  }

  return {
    status: "done",
    value: {
      ...structuredClone(ir),
      operations: structuredClone(ir.operations.filter((operation) => keptIds.has(operation.id))),
    },
  };
}

function compiledIr(compiled: readonly CompiledApi[], planned: PlannedAppDocument): ContractIR {
  const found = compiled.find((each) => each.source === planned.source && each.api === planned.api);

  if (found === undefined) throw new Error(`no compiled api ${planned.source}/${planned.api}`);

  return found.ir;
}

function plannedEntry(planned: ReadonlyMap<string, PlannedEntry>, entryId: string): PlannedEntry {
  const found = planned.get(entryId);

  if (found === undefined) throw new Error(`no planned entry ${entryId}`);

  return found;
}

// The artefacts of each entry, from its target's declarations and its `artefacts` switches.
function selectEntryArtefacts(
  config: LoadedAppConfig,
  targets: ReadonlyMap<string, Target>,
): Step<Map<string, ReadonlySet<string>>> {
  const selected = new Map<string, ReadonlySet<string>>();
  const problems: CliProblem[] = [];

  for (const { entry } of config.entries) {
    const target = targets.get(entry.id);

    if (target === undefined) throw new Error(`no resolved target for the entry ${entry.id}`);

    const selection = selectArtefacts(entry, target);

    if (selection.status === "refused") problems.push(...selection.problems);
    else selected.set(entry.id, selection.artefacts);
  }

  return problems.length > 0
    ? { status: "refused", problems }
    : { status: "done", value: selected };
}

async function resolveTargets(config: LoadedAppConfig): Promise<Step<Map<string, Target>>> {
  const targets = new Map<string, Target>();
  const problems: CliProblem[] = [];

  for (const { entry } of config.entries) {
    const resolved = await resolveTarget(config.file, entry.use, entryWhere(entry.id));

    if (resolved.status === "refused") problems.push(resolved.problem);
    else targets.set(entry.id, resolved.target);
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: targets };
}

function planEachEntry(
  config: LoadedAppConfig,
  targets: ReadonlyMap<string, Target>,
  compiled: readonly CompiledApi[],
): Step<Map<string, PlannedEntry>> {
  const planned = new Map<string, PlannedEntry>();
  const problems: CliProblem[] = [];

  for (const { entry, root } of config.entries) {
    const target = targets.get(entry.id);

    if (target === undefined) throw new Error(`no resolved target for the entry ${entry.id}`);

    const unreadKeyProblems = unreadFrameworkRouteKeyProblems(entry, target);
    const apis = planEntryApis(entry, root, compiled);

    problems.push(...unreadKeyProblems, ...frameworkDocsProblems(entry, target));

    if (apis.status === "refused") problems.push(...apis.problems);
    else planned.set(entry.id, { entry, target, apis: apis.value });
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: planned };
}

// Each api of an entry with its filtered IR; an entry with `apis` writes each under `<out>/<api>`.
function planEntryApis(
  entry: TargetEntry,
  root: string,
  compiled: readonly CompiledApi[],
): Step<PlannedApi[]> {
  const resolved = resolveEntryApis(entry, compiled);

  if (resolved.status === "refused") return resolved;

  const apis: PlannedApi[] = [];
  const problems: CliProblem[] = [];

  for (const { source, api, ir } of resolved.apis) {
    const filtered = filterOperations(ir, {
      ...(entry.document === undefined ? {} : { document: entry.document }),
      ...(entry.operations === undefined ? {} : { operations: entry.operations }),
    });

    if (filtered.status === "refused") {
      problems.push(
        ...filtered.problems.map((problem) => ({ ...problem, where: entryWhere(entry.id, api) })),
      );
    } else {
      apis.push({
        api,
        source,
        ir: filtered.ir,
        root: entry.apis === undefined ? root : join(root, api),
      });
    }
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: apis };
}

export function documentName(planned: PlannedAppDocument): string {
  return planned.document === undefined ? planned.api : `${planned.api}.${planned.document}`;
}
