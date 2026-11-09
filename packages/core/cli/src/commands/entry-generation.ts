import {
  type DescribeOutcome,
  type DescriptorSet,
  GENERATE_TROUBLESHOOTING_URL,
  type GeneratedFile,
  type GenerateWarning,
  type ImportSpecifierStyle,
  LINK_TROUBLESHOOTING_URL,
  type Refusal,
} from "@seampact/codegen-core";
import type { CheckLevel, TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere, problemFromRefusal } from "../cli-problem.js";
import {
  hookCheckLevelOf,
  NATIVE_DOCS_ARTEFACT,
  type PlannedAppDocument,
} from "../config/index.js";
import type { AppPlan } from "./app-plan.js";
import { DEFAULT_DRIFT_CHECK_LEVEL } from "./drift-level.js";
import { linksOf, type PlannedApi, type PlannedEntry, pairedApi } from "./entry-links.js";
import { exclusiveBasePathProblems } from "./exclusive-base-paths.js";
import { frameworkRouteCheckOf } from "./framework-route-check.js";
import { importSpecifierStyles } from "./import-specifier-styles.js";
import { addLink, isLinkKind, type MutableLinkSet, relativeLocation } from "./link-set.js";
import { nativeDocsDocumentOf } from "./native-docs-document.js";
import type { Step } from "./step.js";

// The files of one entry and api, generated in memory before anything is written; `level` is the
// `checks.generated` that governs their drift, `app` the app of a root run.
export interface GeneratedOutput {
  entryId: string;
  api: string;
  root: string;
  files: readonly GeneratedFile[];
  warnings: readonly GenerateWarning[];
  level: CheckLevel;
  app?: string;
}

type GeneratedApi = Omit<GeneratedOutput, "level" | "app">;

// Runs every target's `generate` of one app in memory; `app` names the app of a root run.
export async function generateEntries(
  plan: AppPlan,
  app: string | undefined,
): Promise<Step<GeneratedOutput[]>> {
  const { entries: planned, artefacts } = plan;
  const appDocuments = plan.documents.map(({ planned: appDocument }) => appDocument);
  const level = plan.config.checks?.generated ?? DEFAULT_DRIFT_CHECK_LEVEL;
  const byId = new Map(planned.map((each) => [each.entry.id, each]));
  const describe = memoizedDescribe();
  const styles = importSpecifierStyles(planned);

  if (styles.status === "refused") return styles;

  const basePaths = exclusiveBasePathProblems(planned);

  if (basePaths.status === "refused") return basePaths;

  const outputs: GeneratedOutput[] = [];
  const problems: CliProblem[] = [];

  for (const consumer of planned) {
    for (const plannedApi of consumer.apis) {
      const generated = await generateApi(
        consumer,
        plannedApi,
        byId,
        describe,
        entryArtefacts(artefacts, consumer.entry.id),
        appDocuments,
        plan.config.warnings?.ignore ?? [],
        styles.value.get(consumer.entry.id),
      );

      if (generated.status === "refused") problems.push(...generated.problems);
      else outputs.push({ ...generated.value, level, ...(app === undefined ? {} : { app }) });
    }
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: outputs };
}

async function generateApi(
  consumer: PlannedEntry,
  plannedApi: PlannedApi,
  byId: ReadonlyMap<string, PlannedEntry>,
  describe: Describe,
  artefacts: ReadonlySet<string>,
  appDocuments: readonly PlannedAppDocument[],
  ignoredWarningForms: readonly string[],
  importSpecifiers: ImportSpecifierStyle | undefined,
): Promise<Step<GeneratedApi>> {
  const { entry, target } = consumer;
  const links = buildLinks(consumer, plannedApi, byId, describe);

  if (links.status === "refused") return links;

  const nativeDocs = artefacts.has(NATIVE_DOCS_ARTEFACT)
    ? nativeDocsDocumentOf(entry, plannedApi, appDocuments)
    : undefined;

  if (nativeDocs?.status === "refused") return nativeDocs;

  const outcome = await target.generate({
    ir: plannedApi.ir,
    options: structuredClone(entry.options ?? {}),
    links: links.value,
    artefacts: new Set(artefacts),
    frameworkRoutes: frameworkRouteCheckOf(entry),
    hookCheck: hookCheckLevelOf(entry.artefacts),
    ...(entry.mount === undefined ? {} : { mount: entry.mount }),
    ...(importSpecifiers === undefined ? {} : { importSpecifiers }),
    ...(nativeDocs === undefined ? {} : { nativeDocsDocument: nativeDocs.value }),
    outputDirectory: plannedApi.root,
  });

  if (outcome.status === "refused") {
    const where = refusalWhere(entry, plannedApi.api);

    return {
      status: "refused",
      problems: outcome.refusals.map((refusal) =>
        problemFromRefusal(withDocs(refusal), where(refusal.code), plannedApi),
      ),
    };
  }

  return {
    status: "done",
    value: {
      entryId: entry.id,
      api: plannedApi.api,
      root: plannedApi.root,
      files: outcome.files,
      warnings: (outcome.warnings ?? []).filter(
        (warning) => !isIgnoredWarning(warning, ignoredWarningForms),
      ),
    },
  };
}

// A warning is silenced by its code or by its form: the code without the `.handler` its writer appends.
function isIgnoredWarning(warning: GenerateWarning, ignoredForms: readonly string[]): boolean {
  return ignoredForms.some((form) => warning.code === form || warning.code === `${form}.handler`);
}

function entryArtefacts(
  artefacts: ReadonlyMap<string, ReadonlySet<string>>,
  entryId: string,
): ReadonlySet<string> {
  const found = artefacts.get(entryId);

  if (found === undefined) throw new Error(`no selected artefacts for the entry ${entryId}`);

  return found;
}

// A refusal with no section of its own points at its troubleshooting page.
function withDocs(refusal: Refusal): Refusal {
  if (refusal.docs !== undefined) return refusal;

  const docs = refusal.code.startsWith("link.")
    ? LINK_TROUBLESHOOTING_URL
    : GENERATE_TROUBLESHOOTING_URL;

  return { ...refusal, docs };
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
      problems.push(
        ...described.refusals.map((refusal) =>
          problemFromRefusal(withDocs(refusal), where, providerApi),
        ),
      );
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
