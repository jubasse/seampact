import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type DescribeOutcome,
  type DescriptorSet,
  type GeneratedFile,
  type GenerateWarning,
  type Target,
  writeGeneratedFiles,
} from "@seampact/codegen-core";
import { emitDocuments, type EmitOutcome, parseEmitterOptions } from "@seampact/openapi";
import type { TargetEntry } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems, printWarnings } from "../cli-io.js";
import { type CliProblem, entryWhere, problemFromRefusal } from "../cli-problem.js";
import {
  type LoadedAppConfig,
  openApiSourceNames,
  type PlannedAppDocument,
  planAppDocuments,
  readAppConfig,
  resolveTarget,
} from "../config/index.js";
import { errorCode } from "../error-code.js";
import { resolveEntryApis, usedSources } from "./api-refs.js";
import { type CompiledApi, compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";
import {
  linksOf,
  orderEntries,
  type PlannedApi,
  type PlannedEntry,
  pairedApi,
  pairingProblems,
  unconsumedKindProblems,
  unknownLinkEntryProblems,
  unprovidedKindProblems,
} from "./entry-links.js";
import { filterOperations } from "./filter-operations.js";
import { frameworkRouteCheckOf, unreadFrameworkRouteKeyProblems } from "./framework-route-check.js";
import { addLink, isLinkKind, type MutableLinkSet, relativeLocation } from "./link-set.js";

// The files of one entry and api, generated in memory before anything is written.
interface GeneratedOutput {
  entryId: string;
  api: string;
  root: string;
  files: readonly GeneratedFile[];
  warnings: readonly GenerateWarning[];
}

// One seampact OpenAPI document of the app, with the compiled IR of its api.
interface PlannedDocument {
  planned: PlannedAppDocument;
  ir: ContractIR;
}

// One document's text, rendered in memory before anything is written.
interface EmittedAppDocument {
  name: string;
  file: string;
  text: string;
}

interface GeneratePlan {
  entries: PlannedEntry[];
  documents: PlannedDocument[];
}

type Step<Value> = { status: "done"; value: Value } | { status: "refused"; problems: CliProblem[] };

// `seampact generate`: reads the app config, resolves each target from the app's project, compiles the sources the
// targets and the `openapi` key use, keeps each entry's operations, runs every provider's `describe`, every target's
// `generate` and the OpenAPI emitter in memory, then writes each entry's files and the app's documents only when
// nothing was refused (ADR 0009, ADR 0011, ADR 0015).
export async function generateCommand(location: ConfigLocation, io: CliIo): Promise<number> {
  const planned = await planGenerate(location, io);

  if (planned.status === "refused") {
    printProblems(io, planned.problems);

    return EXIT_REFUSED;
  }

  const generated = await generateEntries(planned.value.entries);
  const emitted = emitAppDocuments(planned.value.documents);
  const problems = [
    ...(generated.status === "refused" ? generated.problems : []),
    ...(emitted.status === "refused" ? emitted.problems : []),
  ];

  if (generated.status === "refused" || emitted.status === "refused") {
    printProblems(io, problems);

    return EXIT_REFUSED;
  }

  const written = await writeOutputs(generated.value, io);

  if (written !== EXIT_SUCCESS) return written;

  return writeAppDocuments(emitted.value, io);
}

async function planGenerate(location: ConfigLocation, io: CliIo): Promise<Step<GeneratePlan>> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return read;

  const { config } = read;
  const entries = config.entries.map(({ entry }) => entry);
  const unknownLinks = unknownLinkEntryProblems(entries);

  if (unknownLinks.length > 0) return { status: "refused", problems: unknownLinks };

  const ordered = orderEntries(entries);

  if (ordered.status === "refused") return ordered;

  const targets = await resolveTargets(config);

  if (targets.status === "refused") return targets;

  const used = usedSources(config);

  if (used.status === "refused") return used;

  const sourceNames = [...new Set([...used.names, ...openApiSourceNames(config)])];
  const compiled = await compileSources(config, sourceNames, io);

  if (compiled.failed) return { status: "refused", problems: compiled.problems };

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
      entries: ordered.entries.map((entry) => plannedEntry(planned.value, entry.id)),
      documents: documents.value,
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

  return {
    status: "done",
    value: plan.documents.map((planned) => ({ planned, ir: compiledIr(compiled, planned) })),
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

    problems.push(...unreadKeyProblems);

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

async function generateEntries(planned: readonly PlannedEntry[]): Promise<Step<GeneratedOutput[]>> {
  const byId = new Map(planned.map((each) => [each.entry.id, each]));
  const describe = memoizedDescribe();
  const outputs: GeneratedOutput[] = [];
  const problems: CliProblem[] = [];

  for (const consumer of planned) {
    for (const plannedApi of consumer.apis) {
      const generated = await generateApi(consumer, plannedApi, byId, describe);

      if (generated.status === "refused") problems.push(...generated.problems);
      else outputs.push(generated.value);
    }
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: outputs };
}

async function generateApi(
  consumer: PlannedEntry,
  plannedApi: PlannedApi,
  byId: ReadonlyMap<string, PlannedEntry>,
  describe: Describe,
): Promise<Step<GeneratedOutput>> {
  const { entry, target } = consumer;
  const links = buildLinks(consumer, plannedApi, byId, describe);

  if (links.status === "refused") return links;

  const artefacts = new Set(
    target.metadata.artefacts
      .filter((artefact) => artefact.defaultOn)
      .map((artefact) => artefact.id),
  );
  const outcome = await target.generate({
    ir: plannedApi.ir,
    options: structuredClone(entry.options ?? {}),
    links: links.value,
    artefacts,
    frameworkRoutes: frameworkRouteCheckOf(entry),
  });

  if (outcome.status === "refused") {
    const where = refusalWhere(entry, plannedApi.api);

    return {
      status: "refused",
      problems: outcome.refusals.map((refusal) => problemFromRefusal(refusal, where(refusal.code))),
    };
  }

  return {
    status: "done",
    value: {
      entryId: entry.id,
      api: plannedApi.api,
      root: plannedApi.root,
      files: outcome.files,
      warnings: outcome.warnings ?? [],
    },
  };
}

// codegen-core's own `link.*` refusals name the kind; the CLI adds both entry ids.
function refusalWhere(entry: TargetEntry, api: string): (code: string) => string {
  const providerIds = linksOf(entry).map(([, providerId]) => `'${providerId}'`);

  return (code) =>
    code.startsWith("link.") && providerIds.length > 0
      ? `entry '${entry.id}' linked to ${providerIds.join(", ")}, api '${api}'`
      : entryWhere(entry.id, api);
}

function buildLinks(
  consumer: PlannedEntry,
  consumerApi: PlannedApi,
  byId: ReadonlyMap<string, PlannedEntry>,
  describe: Describe,
): Step<MutableLinkSet> {
  const links: MutableLinkSet = {};
  const problems: CliProblem[] = [];

  for (const [kind, providerId] of linksOf(consumer.entry)) {
    const provider = byId.get(providerId);
    const providerApi = provider === undefined ? undefined : pairedApi(provider, consumerApi);

    // The link checks of the plan refused these cases before any target ran.
    if (provider === undefined || providerApi === undefined || !isLinkKind(kind)) {
      throw new Error(
        `the link ${kind} of ${consumer.entry.id} to ${providerId} passed the plan's checks unpaired`,
      );
    }

    const where = `entry '${consumer.entry.id}' linked to '${providerId}', api '${consumerApi.api}'`;
    const described = describe(provider, providerApi);

    if (described.status === "refused") {
      problems.push(...described.refusals.map((refusal) => problemFromRefusal(refusal, where)));
      continue;
    }

    const location = relativeLocation(consumerApi.root, providerApi.root);

    if (!addLink(links, kind, structuredClone(described.descriptors), location)) {
      problems.push({
        code: "link.kind.not-described",
        message: `'${providerId}' declares that it provides '${kind}', and its describe returned no '${kind}' descriptor.`,
        fix: `Report it to the maintainers of ${provider.target.metadata.packageName}.`,
        where,
      });
    }
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: links };
}

type Describe = (provider: PlannedEntry, providerApi: PlannedApi) => DescribeOutcome<DescriptorSet>;

// Each provider describes each api once, on its own filtered IR and options, whatever the number of consumers.
function memoizedDescribe(): Describe {
  const described = new Map<string, DescribeOutcome<DescriptorSet>>();

  return (provider, providerApi) => {
    const key = JSON.stringify([provider.entry.id, providerApi.source, providerApi.api]);
    const known = described.get(key);

    if (known !== undefined) return known;

    const outcome = provider.target.describe(
      providerApi.ir,
      structuredClone(provider.entry.options ?? {}),
    );

    described.set(key, outcome);

    return outcome;
  };
}

// Each planned document rendered by the OpenAPI emitter with its options; an api is emitted once per set of options.
function emitAppDocuments(documents: readonly PlannedDocument[]): Step<EmittedAppDocument[]> {
  const emittedApis = new Map<string, EmitOutcome>();
  const emitted: EmittedAppDocument[] = [];
  const problems: CliProblem[] = [];

  for (const { planned, ir } of documents) {
    const name = documentName(planned);
    const where = `openapi document '${name}' (${planned.file})`;
    const options = parseEmitterOptions(structuredClone(planned.options));

    if (options.status === "refused") {
      problems.push(...options.refusals.map((refusal) => problemFromRefusal(refusal, where)));
      continue;
    }

    const key = JSON.stringify([planned.source, planned.api, options.options]);
    const outcome = emittedApis.get(key) ?? emitDocuments(ir, options.options);

    emittedApis.set(key, outcome);

    if (outcome.status === "refused") {
      problems.push(...outcome.refusals.map((refusal) => problemFromRefusal(refusal, where)));
      continue;
    }

    const document = outcome.documents.find((each) => each.name === planned.document);

    if (document === undefined) throw new Error(`the emitter wrote no document ${name}`);

    emitted.push({ name, file: planned.file, text: document.text });
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: emitted };
}

function documentName(planned: PlannedAppDocument): string {
  return planned.document === undefined ? planned.api : `${planned.api}.${planned.document}`;
}

// Writes each document whose text changed; a document already up to date is left untouched.
async function writeAppDocuments(
  documents: readonly EmittedAppDocument[],
  io: CliIo,
): Promise<number> {
  for (const document of documents) {
    const where = `openapi document '${document.name}'`;

    try {
      const unchanged = (await currentText(document.file)) === document.text;

      if (!unchanged) {
        await mkdir(dirname(document.file), { recursive: true });
        await writeFile(document.file, document.text);
      }

      io.stdout(`${where}: ${unchanged ? "unchanged" : "written"} (${document.file}).\n`);
    } catch (error) {
      printProblems(io, [
        {
          code: "openapi.document.write-failed",
          message: `The document ${document.file} could not be written: ${error instanceof Error ? error.message : String(error)}.`,
          fix: "Check that the document's directory is writable, or give the document another path in `openapi`.",
          where,
        },
      ]);

      return EXIT_REFUSED;
    }
  }

  return EXIT_SUCCESS;
}

async function currentText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  }
}

// Writes entry by entry, each all-or-nothing, and stops at the first writer refusal; prints each entry's warnings.
async function writeOutputs(outputs: readonly GeneratedOutput[], io: CliIo): Promise<number> {
  for (const output of outputs) {
    const written = await writeGeneratedFiles(output.root, output.entryId, output.files);
    const where = entryWhere(output.entryId, output.api);

    if (written.status === "refused") {
      printProblems(
        io,
        written.refusals.map((refusal) => problemFromRefusal(refusal, where)),
      );

      return EXIT_REFUSED;
    }

    io.stdout(
      `${where}: ${written.written.length} written, ${written.unchanged.length} unchanged, ${written.removed.length} removed (${output.root}).\n`,
    );
    printWarnings(
      io,
      output.warnings.map((warning) => problemFromRefusal(warning, where)),
    );
  }

  return EXIT_SUCCESS;
}
