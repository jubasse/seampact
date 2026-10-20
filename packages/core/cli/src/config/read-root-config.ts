import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  APP_CONFIG_FILE_NAME,
  APP_ONLY_KEYS,
  type MergedDocumentEntry,
  type OpenApiDocumentOptions,
  ROOT_CONFIG_SCHEMA,
  type RootChecks,
  type RootConfig,
} from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { isRecord } from "../is-record.js";
import {
  type KeyProblem,
  type ParsedConfig,
  parseConfigFile,
  validateConfig,
  whereOf,
} from "./config-file.js";
import { isStrictlyInside } from "./path-containment.js";
import { type ResolvedSource, resolvedSources } from "./resolved-source.js";

// One app a root config lists: its directory as `apps` writes it, and its absolute directory and config file.
export interface WorkspaceApp {
  name: string;
  directory: string;
  file: string;
}

// A merged document of the root, its path absolute and its apps defaulted to every app of `apps`.
export interface LoadedMergedDocument {
  name: string;
  file: string;
  apps: readonly string[];
  prefix: Readonly<Record<string, string>>;
  options: OpenApiDocumentOptions;
}

export interface LoadedRootConfig {
  file: string;
  displayName: string;
  apps: readonly WorkspaceApp[];
  sources: ReadonlyMap<string, ResolvedSource>;
  // The root's `allowLocal`, absent when the root does not set it.
  allowLocal?: boolean;
  openapi: readonly LoadedMergedDocument[];
  checks: RootChecks;
}

export type ReadRootConfigOutcome =
  | { status: "read"; config: LoadedRootConfig }
  | { status: "refused"; problems: CliProblem[] };

// The `checks` an app config takes and a root does not: they concern an app's own targets and framework.
const APP_ONLY_CHECKS = ["generated", "matrix"] as const;

// Reads a monorepo root config (ADR 0011 "The app config"): YAML and prototype keys as an app config, the keys of
// one app refused naming the app config as their place, the value checked against the root schema, then each app
// directory checked to lie below the root and hold its own app config.
export async function readRootConfig(
  file: string,
  displayName: string,
): Promise<ReadRootConfigOutcome> {
  const parsedFile = await parseConfigFile(file, displayName, "root config");

  if (parsedFile.status === "refused") return parsedFile;

  const { parsed, value } = parsedFile;
  const validated = validateConfig<RootConfig>(
    parsed,
    value,
    ROOT_CONFIG_SCHEMA,
    appOnlyKeyProblems(parsed, value),
  );

  if (validated.status === "refused") return validated;

  return resolveRootConfig(file, parsed, validated.config);
}

function appOnlyKeyProblems(parsed: ParsedConfig, value: unknown): KeyProblem[] {
  if (!isRecord(value)) return [];

  const keys = APP_ONLY_KEYS.filter((key) => Object.hasOwn(value, key)).map((key) => [key]);
  const checks = isRecord(value.checks) ? value.checks : {};
  const checkKeys = APP_ONLY_CHECKS.filter((key) => Object.hasOwn(checks, key)).map((key) => [
    "checks",
    key,
  ]);

  return [...keys, ...checkKeys].map((path) => ({
    path,
    problem: {
      code: "config.root.app-key",
      message: `'${path.join(".")}' belongs to one app, and this root config (it holds \`apps\`) takes the keys its apps share.`,
      fix: `Move '${path.join(".")}' to the \`${APP_CONFIG_FILE_NAME}\` of the app it concerns.`,
      where: whereOf(parsed, path),
    },
  }));
}

function resolveRootConfig(
  file: string,
  parsed: ParsedConfig,
  config: RootConfig,
): ReadRootConfigOutcome {
  const directory = dirname(file);
  const apps = config.apps.map((name) => {
    const appDirectory = resolve(directory, name);

    return { name, directory: appDirectory, file: join(appDirectory, APP_CONFIG_FILE_NAME) };
  });
  const openapi = Object.entries(config.openapi ?? {}).map(([name, entry]) =>
    loadedMergedDocument(directory, name, entry, config.apps),
  );

  const problems = [
    ...appPlacementProblems(parsed, directory, apps),
    ...duplicateAppProblems(parsed, apps),
    ...unknownMergedAppProblems(parsed, config),
  ];

  if (problems.length > 0) return { status: "refused", problems };

  const allowLocal = config.allowLocal === undefined ? {} : { allowLocal: config.allowLocal };

  return {
    status: "read",
    config: {
      file,
      displayName: parsed.displayName,
      apps,
      sources: resolvedSources(directory, config.sources),
      ...allowLocal,
      openapi,
      checks: structuredClone(config.checks ?? {}),
    },
  };
}

function loadedMergedDocument(
  directory: string,
  name: string,
  entry: MergedDocumentEntry,
  rootApps: readonly string[],
): LoadedMergedDocument {
  return {
    name,
    file: resolve(directory, entry.path),
    apps: [...(entry.apps ?? rootApps)],
    prefix: structuredClone(entry.prefix ?? {}),
    options: documentOptionsOf(entry),
  };
}

// The emitter options a placed document or a merged document writes beside its own keys.
export function documentOptionsOf(entry: OpenApiDocumentOptions): OpenApiDocumentOptions {
  const { extensions, reasons, inputSchemas, servers } = entry;

  return structuredClone({
    ...(extensions === undefined ? {} : { extensions }),
    ...(reasons === undefined ? {} : { reasons }),
    ...(inputSchemas === undefined ? {} : { inputSchemas }),
    ...(servers === undefined ? {} : { servers }),
  });
}

// An app lies strictly below the root and holds its own app config (A46: the config is trusted, but an app outside
// the root would make the root's relative paths ambiguous).
function appPlacementProblems(
  parsed: ParsedConfig,
  directory: string,
  apps: readonly WorkspaceApp[],
): CliProblem[] {
  return apps.flatMap((app, index): CliProblem[] => {
    const where = whereOf(parsed, ["apps", index]);

    if (app.directory === directory) {
      return [
        {
          code: "config.apps.outside",
          message: `'${app.name}' is the root config's own directory; each app has its own directory below it.`,
          fix: "Move the app into a directory of its own below the root, with its own `seampact.config.yaml`.",
          where,
        },
      ];
    }

    if (!isStrictlyInside(directory, app.directory)) {
      return [
        {
          code: "config.apps.outside",
          message: `The app directory '${app.name}' is not below the root config's directory (${directory}).`,
          fix: "List app directories relative to the root config, below it.",
          where,
        },
      ];
    }

    if (!existsSync(app.file)) {
      return [
        {
          code: "config.apps.no-config",
          message: `The app directory '${app.name}' holds no \`${APP_CONFIG_FILE_NAME}\`.`,
          fix: `Create the app's \`${APP_CONFIG_FILE_NAME}\`, or correct the directory in \`apps\`.`,
          where,
        },
      ];
    }

    return [];
  });
}

// Two spellings of one directory (`apps/api`, `apps/api/`) would run one app twice.
function duplicateAppProblems(parsed: ParsedConfig, apps: readonly WorkspaceApp[]): CliProblem[] {
  return apps.flatMap((app, index) => {
    const first = apps.slice(0, index).find((other) => other.directory === app.directory);

    if (first === undefined) return [];

    return [
      {
        code: "config.apps.duplicate",
        message: `'${app.name}' and '${first.name}' name the same app directory.`,
        fix: "List each app once.",
        where: whereOf(parsed, ["apps", index]),
      },
    ];
  });
}

function unknownMergedAppProblems(parsed: ParsedConfig, config: RootConfig): CliProblem[] {
  return Object.entries(config.openapi ?? {}).flatMap(([name, entry]) =>
    (entry.apps ?? [])
      .map((app, index) => ({ app, index }))
      .filter(({ app }) => !config.apps.includes(app))
      .map(({ app, index }) => ({
        code: "config.openapi.unknown-app",
        message: `The merged document '${name}' covers '${app}', which \`apps\` does not list (${config.apps.join(", ")}).`,
        fix: "Name app directories as `apps` writes them, or add the app to `apps`.",
        where: whereOf(parsed, ["openapi", name, "apps", index]),
      })),
  );
}
