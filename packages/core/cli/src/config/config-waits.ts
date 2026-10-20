import { BOOT_CHECK_ARTEFACT } from "@seampact/spec/config";
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

const SERVER_ENTRY_BRINGER = "the server targets, through a codegen-core seam (p5)";

// The handler check of the boot check comes with the access hooks (ADR 0012).
const BOOT_CHECK_SWITCH_WAITS: Readonly<Record<string, string>> = {
  handlers: SERVER_ENTRY_BRINGER,
};

const ENTRY_KEY_WAITS: Readonly<Record<string, string>> = {
  mount: SERVER_ENTRY_BRINGER,
  access: SERVER_ENTRY_BRINGER,
};

const NATIVE_RUNNER_BRINGER = "the native runners, Gradle, Maven and Composer (p6)";

// A module link only arises across the apps of a monorepo, and no app links across apps yet.
const MODULE_LINK_BRINGER = "links across the apps of a monorepo, once an app needs one";

// Every key or value form of an app config that waits; `config` is the parsed YAML, not yet schema-checked.
export function findConfigWaits(config: unknown): ConfigWait[] {
  if (!isRecord(config)) return [];

  return Array.isArray(config.targets) ? config.targets.flatMap(targetEntryWaits) : [];
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
