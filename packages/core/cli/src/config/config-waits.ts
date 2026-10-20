import { BOOT_CHECK_ARTEFACT, ROOT_CONFIG_MARKER_KEY } from "@seampact/spec/config";
import { isRecord } from "../is-record.js";
import type { KeyPath } from "./key-path.js";

// The keys and value forms of ADR 0011 the Node CLI does not read yet, each with the work that brings it. The
// reader refuses each by name (`config.key.waits`), never ignores it.

export interface ConfigWait {
  path: KeyPath;
  what: string;
  bringer: string;
  // The fix when it is not to remove the key.
  fix?: string;
}

const ROOT_KEY_WAITS: Readonly<Record<string, string>> = {
  diff: "the `diff` command (p3-cli)",
};

const CHECKS_KEY_WAITS: Readonly<Record<string, string>> = {
  openapi: "the `check` command (p3-cli)",
  generated: "the `check` command (p3-cli)",
};

// A command run on a root config, a file holding `apps`, waits as a whole: the root's merged documents and their
// drift check are written and checked by root runs only (ADR 0011 "Which OpenAPI documents exist").
const ROOT_RUN_WAIT: ConfigWait = {
  path: [ROOT_CONFIG_MARKER_KEY],
  what: "running a command on the monorepo root config, with its merged `openapi` documents and `checks`",
  bringer: "root runs of `generate` and `check` (p3-cli, p3-openapi)",
  fix: "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
};

const SERVER_ENTRY_BRINGER = "the server targets, through a codegen-core seam (p5)";

// The handler check of the boot check comes with the access hooks (ADR 0012).
const BOOT_CHECK_SWITCH_WAITS: Readonly<Record<string, string>> = {
  handlers: SERVER_ENTRY_BRINGER,
};

const ENTRY_KEY_WAITS: Readonly<Record<string, string>> = {
  mount: SERVER_ENTRY_BRINGER,
  access: SERVER_ENTRY_BRINGER,
  frameworkDocs: SERVER_ENTRY_BRINGER,
};

const NATIVE_RUNNER_BRINGER = "the native runners, Gradle, Maven and Composer (p6)";

const MODULE_LINK_BRINGER = "links to outputs in other packages (p3-config)";

// Every key or value form of an app config that waits; `config` is the parsed YAML, not yet schema-checked. A root
// config waits as a whole.
export function findConfigWaits(config: unknown): ConfigWait[] {
  if (!isRecord(config)) return [];

  if (Object.hasOwn(config, ROOT_CONFIG_MARKER_KEY)) return [ROOT_RUN_WAIT];

  const rootWaits = waitingKeysOf(config, [], ROOT_KEY_WAITS);
  const checksWaits = isRecord(config.checks)
    ? waitingKeysOf(config.checks, ["checks"], CHECKS_KEY_WAITS)
    : [];
  const targetWaits = Array.isArray(config.targets) ? config.targets.flatMap(targetEntryWaits) : [];

  return [...rootWaits, ...checksWaits, ...targetWaits];
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

// Every artefact switch is read but the boot check's `handlers`.
function artefactSwitchWaits(artefacts: unknown, path: KeyPath): ConfigWait[] {
  const bootCheck = isRecord(artefacts) ? artefacts[BOOT_CHECK_ARTEFACT] : undefined;

  if (!isRecord(bootCheck)) return [];

  return Object.entries(BOOT_CHECK_SWITCH_WAITS)
    .filter(([key]) => Object.hasOwn(bootCheck, key))
    .map(([key, bringer]) => ({
      path: [...path, BOOT_CHECK_ARTEFACT, key],
      what: `the boot check switch '${key}'`,
      bringer,
    }));
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
