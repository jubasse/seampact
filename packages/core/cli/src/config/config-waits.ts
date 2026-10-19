import { isRecord } from "../is-record.js";
import type { KeyPath } from "./key-path.js";

// The keys and value forms of ADR 0011 the Node CLI does not read yet, each with the work that brings it. The
// reader refuses each by name (`config.key.waits`), never ignores it.

export interface ConfigWait {
  path: KeyPath;
  what: string;
  bringer: string;
}

const ROOT_KEY_WAITS: Readonly<Record<string, string>> = {
  apps: "the monorepo root config (p3-config)",
  allowLocal: "the local-source check for shared branches (p3-dist)",
  openapi: "the OpenAPI documents (p3-openapi)",
  checks: "the `check` command and the compatibility matrix (p3-cli, p3-config)",
};

const SOURCE_KEY_WAITS: Readonly<Record<string, string>> = {
  package: "package and release sources (p3-dist)",
  release: "package and release sources (p3-dist)",
  git: "package and release sources (p3-dist)",
  version: "package and release sources (p3-dist)",
  integrity: "package and release sources (p3-dist)",
};

const SERVER_ENTRY_BRINGER = "the server targets, through a codegen-core seam (p5)";

const ARTEFACT_SWITCH_BRINGER = "artefact switches and their checks (p3-config)";

const ENTRY_KEY_WAITS: Readonly<Record<string, string>> = {
  mount: SERVER_ENTRY_BRINGER,
  access: SERVER_ENTRY_BRINGER,
  frameworkDocs: SERVER_ENTRY_BRINGER,
  allowUntested: "the compatibility matrix (p3-config)",
};

const NATIVE_RUNNER_BRINGER = "the native runners, Gradle, Maven and Composer (p6)";

const MODULE_LINK_BRINGER = "links to outputs in other packages (p3-config)";

// Every key or value form of `config` that waits; `config` is the parsed YAML, not yet schema-checked.
export function findConfigWaits(config: unknown): ConfigWait[] {
  if (!isRecord(config)) return [];

  const rootWaits = waitingKeysOf(config, [], ROOT_KEY_WAITS);
  const sourceWaits = isRecord(config.sources) ? sourcesWaits(config.sources) : [];
  const targetWaits = Array.isArray(config.targets) ? config.targets.flatMap(targetEntryWaits) : [];

  return [...rootWaits, ...sourceWaits, ...targetWaits];
}

function sourcesWaits(sources: Record<string, unknown>): ConfigWait[] {
  return Object.entries(sources).flatMap(([name, source]) =>
    isRecord(source) ? waitingKeysOf(source, ["sources", name], SOURCE_KEY_WAITS) : [],
  );
}

function targetEntryWaits(entry: unknown, index: number): ConfigWait[] {
  if (!isRecord(entry)) return [];

  const path = ["targets", index];
  const keyWaits = waitingKeysOf(entry, path, ENTRY_KEY_WAITS);
  const artefactWaits = Object.hasOwn(entry, "artefacts")
    ? artefactSwitchWaits(entry.artefacts, [...path, "artefacts"])
    : [];
  const useWaits = typeof entry.use === "string" ? nativeUseWaits(entry.use, [...path, "use"]) : [];
  const linkWaits = isRecord(entry.link) ? moduleLinkWaits(entry.link, [...path, "link"]) : [];

  return [...keyWaits, ...artefactWaits, ...useWaits, ...linkWaits];
}

// `artefacts.bootCheck.frameworkRoutes` is read; every other artefact switch waits, `bootCheck` as a whole too.
function artefactSwitchWaits(artefacts: unknown, path: KeyPath): ConfigWait[] {
  if (!isRecord(artefacts)) return [];

  const switchWaits = Object.keys(artefacts)
    .filter((key) => key !== "bootCheck")
    .map((key) => switchWait([...path, key], `the artefact switch '${key}'`));

  if (!Object.hasOwn(artefacts, "bootCheck")) return switchWaits;

  const bootCheckPath = [...path, "bootCheck"];

  if (!isRecord(artefacts.bootCheck)) {
    return [...switchWaits, switchWait(bootCheckPath, "the artefact switch 'bootCheck'")];
  }

  const bootCheckWaits = Object.keys(artefacts.bootCheck)
    .filter((key) => key !== "frameworkRoutes")
    .map((key) => switchWait([...bootCheckPath, key], `the boot check switch '${key}'`));

  return [...switchWaits, ...bootCheckWaits];
}

function switchWait(path: KeyPath, what: string): ConfigWait {
  return { path, what, bringer: ARTEFACT_SWITCH_BRINGER };
}

// A Maven `group:artifact` coordinate or a Composer `vendor/name`; npm names never hold a colon, and an unscoped
// npm name never holds a slash.
function nativeUseWaits(use: string, path: KeyPath): ConfigWait[] {
  const isMavenCoordinate = use.includes(":");
  const isComposerPackage = !use.startsWith("@") && !use.startsWith(".") && use.includes("/");

  if (!isMavenCoordinate && !isComposerPackage) return [];

  return [{ path, what: `the native target '${use}'`, bringer: NATIVE_RUNNER_BRINGER }];
}

function moduleLinkWaits(link: Record<string, unknown>, path: KeyPath): ConfigWait[] {
  return Object.entries(link)
    .filter(([, value]) => isRecord(value))
    .map(([kind]) => ({
      path: [...path, kind],
      what: "a link with an explicit module specifier",
      bringer: MODULE_LINK_BRINGER,
    }));
}

function waitingKeysOf(
  value: Record<string, unknown>,
  path: KeyPath,
  waits: Readonly<Record<string, string>>,
): ConfigWait[] {
  return Object.entries(waits)
    .filter(([key]) => Object.hasOwn(value, key))
    .map(([key, bringer]) => ({ path: [...path, key], what: `the key '${key}'`, bringer }));
}
