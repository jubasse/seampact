import { dirname, resolve } from "node:path";
import {
  APP_CONFIG_SCHEMA,
  type AppChecks,
  type AppConfig,
  type AppOpenApi,
  type AppWarnings,
  DEFAULT_OUT_DIR,
  type DiffConfig,
  ROOT_CONFIG_MARKER_KEY,
  type TargetEntry,
} from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { apiRefsOf, parseApiRef } from "../commands/api-refs.js";
import { isRecord } from "../is-record.js";
import { isFrameworkRouteCheckOff } from "./artefact-switches.js";
import {
  type ParsedConfig,
  parseConfigFile,
  validateConfig,
  waitProblems,
  whereOf,
} from "./config-file.js";
import { findConfigWaits } from "./config-waits.js";
import { findRootConfig } from "./find-root-config.js";
import { isInsideOrEqual, isStrictlyInside } from "./path-containment.js";
import type { LoadedRootConfig } from "./read-root-config.js";
import { type ResolvedSource, resolvedSources } from "./resolved-source.js";

// One target entry with its output root: `<outDir>/<out>`, absolute.
export interface AppConfigEntry {
  entry: TargetEntry;
  root: string;
}

export interface LoadedAppConfig {
  file: string;
  outDir: string;
  // The app's `allowLocal`, else its root's; absent when neither sets it.
  allowLocal?: boolean;
  // The app's own sources and, for an app its root lists, the root's.
  sources: ReadonlyMap<string, ResolvedSource>;
  entries: readonly AppConfigEntry[];
  // The app's `openapi` as it writes it; absent when the app does not write the key.
  openapi?: AppOpenApi;
  // The app's `checks` as it writes them; absent when the app does not write the key.
  checks?: AppChecks;
  // The app's `diff` settings as it writes them; absent when the app does not write the key.
  diff?: DiffConfig;
  // The app's `warnings` as it writes them; absent when the app does not write the key.
  warnings?: AppWarnings;
  // The root config folded in, for an app its root lists.
  rootFile?: string;
}

export type ReadAppConfigOutcome =
  | { status: "read"; config: LoadedAppConfig }
  | { status: "refused"; problems: CliProblem[] };

// The app config as its own file writes it, before its root is folded in.
interface AppConfigAlone {
  parsed: ParsedConfig;
  config: AppConfig;
  loaded: LoadedAppConfig;
}

type ReadAloneOutcome =
  | { status: "read"; app: AppConfigAlone }
  | { status: "refused"; problems: CliProblem[] };

// Reads `seampact.config.yaml` (ADR 0011 "The app config"): YAML, prototype keys and waiting keys refused, the
// value checked against the app config schema, paths resolved against the config file's directory. The app's root
// config, when one lists it, is then folded in: its sources beside the app's and its `allowLocal` under the app's.
export async function readAppConfig(
  file: string,
  displayName: string,
): Promise<ReadAppConfigOutcome> {
  const alone = await readAppConfigAlone(file, displayName);

  if (alone.status === "refused") return alone;

  const discovery = await findRootConfig(file, displayName);

  if (discovery.status === "refused") return discovery;

  if (discovery.status === "none") return { status: "read", config: alone.app.loaded };

  if (!discovery.listed) return unlistedAppOutcome(alone.app, discovery.root);

  return foldRootConfig(alone.app, discovery.root);
}

// Reads the app config of an app the root config lists, with that root folded in, whatever root lies nearer.
export async function readListedAppConfig(
  file: string,
  displayName: string,
  root: LoadedRootConfig,
): Promise<ReadAppConfigOutcome> {
  const alone = await readAppConfigAlone(file, displayName);

  if (alone.status === "refused") return alone;

  return foldRootConfig(alone.app, root);
}

async function readAppConfigAlone(file: string, displayName: string): Promise<ReadAloneOutcome> {
  const parsedFile = await parseConfigFile(file, displayName, "app config");

  if (parsedFile.status === "refused") return parsedFile;

  const { parsed, value } = parsedFile;
  const keyProblems = waitProblems(parsed, findConfigWaits(value));

  // A root config is not read as an app's: a command that runs on a root reads it with `readRunConfig`.
  if (isRecord(value) && Object.hasOwn(value, ROOT_CONFIG_MARKER_KEY)) {
    return { status: "refused", problems: [rootConfigProblem(parsed)] };
  }

  const validated = validateConfig<AppConfig>(parsed, value, APP_CONFIG_SCHEMA, keyProblems);

  if (validated.status === "refused") return validated;

  return resolveAppConfig(file, parsed, validated.config);
}

function rootConfigProblem(parsed: ParsedConfig): CliProblem {
  return {
    code: "config.root.not-an-app",
    message: `This file is a monorepo root config (it holds \`${ROOT_CONFIG_MARKER_KEY}\`), and the command runs on one app's config.`,
    fix: "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
    where: whereOf(parsed, [ROOT_CONFIG_MARKER_KEY]),
  };
}

function resolveAppConfig(file: string, parsed: ParsedConfig, config: AppConfig): ReadAloneOutcome {
  const directory = dirname(file);
  const outDir = resolve(directory, config.outDir ?? DEFAULT_OUT_DIR);
  const targets = config.targets ?? [];
  const entries = targets.map((entry) => ({
    entry: structuredClone(entry),
    root: resolve(outDir, entry.out ?? entry.id),
  }));

  const problems = [
    ...duplicateIdProblems(parsed, targets),
    ...outsideOutDirProblems(parsed, outDir, entries),
    ...overlappingOutProblems(parsed, entries),
    ...switchedOffAllowListProblems(parsed, targets),
    ...frameworkDocsConflictProblems(parsed, targets),
  ];

  if (problems.length > 0) return { status: "refused", problems };

  const allowLocal = config.allowLocal === undefined ? {} : { allowLocal: config.allowLocal };
  const openapi = config.openapi === undefined ? {} : { openapi: structuredClone(config.openapi) };
  const checks = config.checks === undefined ? {} : { checks: structuredClone(config.checks) };
  const diff = config.diff === undefined ? {} : { diff: structuredClone(config.diff) };
  const warnings =
    config.warnings === undefined ? {} : { warnings: structuredClone(config.warnings) };
  const loaded: LoadedAppConfig = {
    file,
    outDir,
    ...allowLocal,
    sources: resolvedSources(directory, config.sources),
    entries,
    ...openapi,
    ...checks,
    ...diff,
    ...warnings,
  };

  return { status: "read", app: { parsed, config, loaded } };
}

// The root's sources beside the app's, a name in both refused; `allowLocal` as the app writes it, else the root's
// (ADR 0011 "Refusing local sources on shared branches").
function foldRootConfig(app: AppConfigAlone, root: LoadedRootConfig): ReadAppConfigOutcome {
  const problems = [...app.loaded.sources.keys()]
    .filter((name) => root.sources.has(name))
    .map((name) => ({
      code: "config.source.duplicate",
      message: `The source '${name}' is defined both in this app config and in its root config ${root.displayName}.`,
      fix: "Remove the app's definition to use the root's source, or rename one of them.",
      where: whereOf(app.parsed, ["sources", name]),
    }));

  if (problems.length > 0) return { status: "refused", problems };

  const allowLocal = app.config.allowLocal ?? root.allowLocal;

  return {
    status: "read",
    config: {
      ...app.loaded,
      ...(allowLocal === undefined ? {} : { allowLocal }),
      sources: new Map([...root.sources, ...app.loaded.sources]),
      rootFile: root.file,
    },
  };
}

// An app the nearest root does not list stands alone; a source name it takes from that root names the fix.
function unlistedAppOutcome(app: AppConfigAlone, root: LoadedRootConfig): ReadAppConfigOutcome {
  const rootOnlySources = [...root.sources.keys()].filter((name) => !app.loaded.sources.has(name));
  const problems = (app.config.targets ?? []).flatMap((entry, index) =>
    apiRefsOf(entry)
      .filter((text) => {
        const { source } = parseApiRef(text);

        return source !== undefined && rootOnlySources.includes(source);
      })
      .map((text) => ({
        code: "config.app.unlisted",
        message: `The api '${text}' names a source of the root config ${root.displayName}, whose \`apps\` does not list this app (${dirname(app.loaded.file)}), so the app stands alone.`,
        fix: "Add the app's directory to the root config's `apps`, or define the source in this app config.",
        where: whereOf(app.parsed, ["targets", index]),
      })),
  );

  if (problems.length > 0) return { status: "refused", problems };

  return { status: "read", config: app.loaded };
}

function duplicateIdProblems(parsed: ParsedConfig, targets: readonly TargetEntry[]): CliProblem[] {
  return targets
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => targets.findIndex((other) => other.id === entry.id) !== index)
    .map(({ entry, index }) => ({
      code: "config.target.duplicate-id",
      message: `Two target entries have the id '${entry.id}'.`,
      fix: "Give each target entry its own id.",
      where: whereOf(parsed, ["targets", index, "id"]),
    }));
}

// An allow-list of a check switched off would be dropped without a word.
function switchedOffAllowListProblems(
  parsed: ParsedConfig,
  targets: readonly TargetEntry[],
): CliProblem[] {
  return targets
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        entry.frameworkRoutes !== undefined && isFrameworkRouteCheckOff(entry.artefacts),
    )
    .map(({ entry, index }) => ({
      code: "config.key.conflict",
      message: `The entry '${entry.id}' allow-lists framework routes in 'frameworkRoutes' but switches their check off with '${switchOffKey(entry)}: false'.`,
      fix: "Keep one: remove 'frameworkRoutes' to leave the check off, or remove the switch to check the routes against the allow-list.",
      where: whereOf(parsed, ["targets", index, "frameworkRoutes"]),
    }));
}

// `frameworkDocs: off` asks for no framework document while `nativeDocs` completes one.
function frameworkDocsConflictProblems(
  parsed: ParsedConfig,
  targets: readonly TargetEntry[],
): CliProblem[] {
  return targets
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.frameworkDocs === "off" && entry.artefacts?.nativeDocs === true)
    .map(({ entry, index }) => ({
      code: "config.key.conflict",
      message: `The entry '${entry.id}' sets 'frameworkDocs: off' and 'artefacts.nativeDocs: true': one switches the framework's document off, the other completes it.`,
      fix: "Keep one: remove 'frameworkDocs: off' to complete the framework's document, or switch 'artefacts.nativeDocs' off.",
      where: whereOf(parsed, ["targets", index, "frameworkDocs"]),
    }));
}

function switchOffKey(entry: TargetEntry): string {
  return entry.artefacts?.bootCheck === false
    ? "artefacts.bootCheck"
    : "artefacts.bootCheck.frameworkRoutes";
}

function outsideOutDirProblems(
  parsed: ParsedConfig,
  outDir: string,
  entries: readonly AppConfigEntry[],
): CliProblem[] {
  return entries
    .map((each, index) => ({ each, index }))
    .filter(({ each }) => !isStrictlyInside(outDir, each.root))
    .map(({ each, index }) => ({
      code: "config.out.outside",
      message: `The output directory of '${each.entry.id}' is not inside \`outDir\` (${outDir}).`,
      fix: "Give `out` a relative path that stays inside `outDir`.",
      where: whereOf(parsed, ["targets", index, "out"]),
    }));
}

// Two entries writing to the same directory, or one inside the other, would remove each other's files.
function overlappingOutProblems(
  parsed: ParsedConfig,
  entries: readonly AppConfigEntry[],
): CliProblem[] {
  return entries.flatMap((each, index) =>
    entries
      .slice(index + 1)
      .filter(
        (other) => isInsideOrEqual(each.root, other.root) || isInsideOrEqual(other.root, each.root),
      )
      .map((other) => ({
        code: "config.out.overlap",
        message: `The entries '${each.entry.id}' and '${other.entry.id}' write to the same directory, or one inside the other.`,
        fix: "Give each entry its own `out` directory, side by side under `outDir`.",
        where: whereOf(parsed, ["targets", index]),
      })),
  );
}
