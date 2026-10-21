import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parse, parseDocument, stringify } from "yaml";
import type { ValidatorChoice } from "./validator-choice.ts";

// The file that marks a directory as a consumer this script made, holding the monorepo commit it was built from.
export const COMMIT_FILE = ".seampact-commit";

// The file that names the target a consumer was assembled for, which the http suite's reports carry.
export const TARGET_FILE = ".seampact-target";

/** A target id names one directory under `targets/`: lowercase letters, digits and dashes. */
export const TARGET_ID = /^[a-z0-9-]+$/;

export const VENDOR_DIRECTORY = "vendor/seampact";

// Config entries an overlay appends to the template config's `targets` list, as YAML list items.
const CONFIG_ENTRIES_FILE = "seampact.config.entries.yaml";

// Dependencies an overlay adds to the template manifest's `dependencies`, as a name-to-version JSON object: copying
// an overlay package.json would replace the template's.
const PACKAGE_ENTRIES_FILE = "package.entries.json";

// An overlay built on another overlay (a framework major, or the front layers over a server) names it in this file,
// one target id; the chain of bases may be of any depth, and the deepest base is copied first and its entries
// apply first.
const OVERLAY_BASE_FILE = "overlay.base";
const OVERLAY_FILES = [CONFIG_ENTRIES_FILE, PACKAGE_ENTRIES_FILE, OVERLAY_BASE_FILE];
const CONFIG_FILE = "seampact.config.yaml";
const PACKAGE_FILE = "package.json";
const CONTRACT_DIRECTORY = "contract";

// The template config's `use:` value of its `validators` entry, replaced by the chosen provider package.
const VALIDATORS_PLACEHOLDER = "{{validators}}";

// The template's `validators` entry and the `validators` link lines of an overlay, which a validator the target
// generates itself leaves out.
const VALIDATORS_ENTRY_START = "  - id: validators";
const ENTRY_START = "  - id:";
const VALIDATORS_LINK_LINE = /^\s*validators: validators\s*$/;

// pnpm 11 and later read `overrides` from the workspace file only, not from the `pnpm` field of package.json.
const PNPM_SETTINGS_FILE = "pnpm-workspace.yaml";

// pnpm refuses an install whose dependencies have build scripts it was not told about: esbuild, under the tsx that
// starts the boot processes of the http suite, checks its platform binary in its own.
const ALLOWED_BUILDS = { esbuild: true };

type WorkspaceSettings = Record<string, unknown>;

interface ConsumerManifest {
  dependencies?: Record<string, string>;
  [member: string]: unknown;
}

// Empties the directory for a fresh consumer; refuses a non-empty directory this script did not make.
export function prepareConsumerDirectory(directory: string): void {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    if (!existsSync(join(directory, COMMIT_FILE))) {
      throw new Error(
        `consumers: ${directory} is not empty and has no ${COMMIT_FILE}, so it is not a consumer this script made; choose another --dir or empty it.`,
      );
    }

    rmSync(directory, { recursive: true, force: true });
  }

  mkdirSync(directory, { recursive: true });
}

// Files a tool copies into the consumer, in `into` relative to its root, with the dependencies they need.
export interface ConsumerExtras {
  readonly sourceDirectory: string;
  readonly into: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** A `key=value` pair written into the `options` of every config entry of the target overlay. */
export interface TargetOption {
  readonly key: string;
  /** Read as YAML, so `true` is a boolean. */
  readonly value: string;
}

const TARGET_OPTION = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/;

/** The target options of `--target-option <key>=<value>` flags, or the message naming the malformed one. */
export function parseTargetOptions(written: readonly string[]): TargetOption[] | string {
  const targetOptions: TargetOption[] = [];

  for (const flag of written) {
    const [, key, value] = TARGET_OPTION.exec(flag) ?? [];

    if (key === undefined || value === undefined) {
      return `--target-option '${flag}' is not <key>=<value>: write it as reply=interceptor.`;
    }

    targetOptions.push({ key, value });
  }

  return targetOptions;
}

// The template with the chosen validators, the target overlay copied over it after its chain of base overlays (their
// config and package entries merged, with the target options), the extras if any, and the reference contract. A pair or
// an option the target refuses fails at `generate`, naming it.
export function assembleConsumer(options: {
  readonly consumersRoot: string;
  readonly repositoryRoot: string;
  readonly target: string;
  readonly validators: ValidatorChoice;
  readonly directory: string;
  readonly commit: string;
  readonly extras?: ConsumerExtras;
  readonly targetOptions?: readonly TargetOption[];
}): void {
  const { consumersRoot, directory } = options;

  if (!TARGET_ID.test(options.target)) {
    throw new Error(
      `consumers: target '${options.target}' is not a target id; it must match ${TARGET_ID.source}.`,
    );
  }

  const overlays = overlayChain(join(consumersRoot, "targets"), options.target);

  cpSync(join(consumersRoot, "template"), directory, { recursive: true });
  useValidators(options.validators, directory);

  const linkedEntries =
    options.validators.package === undefined ? withoutValidatorsLinks : keepAsWritten;
  const overlayEntries = (entries: string) =>
    withTargetOptions(linkedEntries(entries), options.targetOptions ?? []);

  for (const overlay of overlays) {
    cpSync(overlay, directory, {
      recursive: true,
      filter: (source) => !OVERLAY_FILES.some((file) => source.endsWith(file)),
    });
    appendConfigEntries(
      join(overlay, CONFIG_ENTRIES_FILE),
      join(directory, CONFIG_FILE),
      overlayEntries,
    );
    addPackageEntries(join(overlay, PACKAGE_ENTRIES_FILE), join(directory, PACKAGE_FILE));
  }

  if (options.extras !== undefined) {
    cpSync(options.extras.sourceDirectory, join(directory, options.extras.into), {
      recursive: true,
    });
    addDependencies(join(directory, PACKAGE_FILE), options.extras.dependencies);
  }

  cpSync(join(options.repositoryRoot, "fixtures/reference"), join(directory, CONTRACT_DIRECTORY), {
    recursive: true,
  });
  writeFileSync(join(directory, COMMIT_FILE), `${options.commit}\n`);
  writeFileSync(join(directory, TARGET_FILE), `${options.target}\n`);
}

function useValidators(choice: ValidatorChoice, directory: string): void {
  const configFile = join(directory, CONFIG_FILE);
  const config = readFileSync(configFile, "utf8");

  if (config.split(VALIDATORS_PLACEHOLDER).length !== 2) {
    throw new Error(
      `consumers: the template ${CONFIG_FILE} must hold '${VALIDATORS_PLACEHOLDER}' once, as the \`use\` of its validators entry.`,
    );
  }

  writeFileSync(
    configFile,
    choice.package === undefined
      ? withoutValidatorsEntry(config)
      : config.replace(VALIDATORS_PLACEHOLDER, choice.package),
  );
  addDependencies(join(directory, PACKAGE_FILE), choice.dependencies);
}

// The config without the `validators` entry: its lines up to the next entry.
function withoutValidatorsEntry(config: string): string {
  let inValidatorsEntry = false;

  return config
    .split("\n")
    .filter((line) => {
      if (line.startsWith(VALIDATORS_ENTRY_START)) inValidatorsEntry = true;
      else if (line.startsWith(ENTRY_START)) inValidatorsEntry = false;

      return !inValidatorsEntry;
    })
    .join("\n");
}

// The target's overlay after its bases, each base's own chain first and in the order `overlay.base` lists them. An
// overlay reached twice is kept once, at its first place; a chain may not come back to an overlay on its current path.
export function overlayChain(targetsRoot: string, target: string): string[] {
  const chain: string[] = [];

  addOverlayAfterBases(targetsRoot, target, [], chain);

  return chain.map((overlay) => join(targetsRoot, overlay));
}

function addOverlayAfterBases(
  targetsRoot: string,
  overlay: string,
  path: readonly string[],
  chain: string[],
): void {
  if (path.includes(overlay)) {
    throw new Error(
      `consumers: the overlay bases form a cycle: ${[...path, overlay].join(" -> ")}; make one overlay of the chain name no ${OVERLAY_BASE_FILE}.`,
    );
  }

  for (const base of overlayBases(targetsRoot, overlay)) {
    addOverlayAfterBases(targetsRoot, base, [...path, overlay], chain);
  }

  if (!chain.includes(overlay)) chain.push(overlay);
}

// The target ids an overlay's `overlay.base` names, one per line, in order; none without the file.
function overlayBases(targetsRoot: string, target: string): string[] {
  const overlay = join(targetsRoot, target);

  if (!existsSync(overlay)) {
    const known = readdirSync(targetsRoot).sort().join(", ");

    throw new Error(`consumers: no overlay for target '${target}'; known targets: ${known}.`);
  }

  const baseFile = join(overlay, OVERLAY_BASE_FILE);

  if (!existsSync(baseFile)) return [];

  const bases = readFileSync(baseFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  for (const base of bases) {
    if (!TARGET_ID.test(base)) {
      throw new Error(
        `consumers: ${baseFile} must name target overlay ids (${TARGET_ID.source}), one per line, not '${base}'.`,
      );
    }
  }

  return bases;
}

// The template config ends with its `targets` list, so the overlay's items extend it.
function appendConfigEntries(
  entriesFile: string,
  configFile: string,
  adapt: (entries: string) => string,
): void {
  if (!existsSync(entriesFile)) return;

  const config = readFileSync(configFile, "utf8").trimEnd();
  const entries = readFileSync(entriesFile, "utf8").trimEnd();

  writeFileSync(configFile, `${config}\n${adapt(entries)}\n`);
}

/** The overlay's config entries, a YAML list, with each target option set in every entry's `options`. */
export function withTargetOptions(entries: string, targetOptions: readonly TargetOption[]): string {
  if (targetOptions.length === 0) return entries;

  const document = parseDocument(entries);

  if (!isSeq(document.contents)) {
    throw new Error(
      "consumers: an overlay's config entries must be a YAML list of target entries.",
    );
  }

  for (const entry of document.contents.items) {
    if (!isMap(entry)) throw new Error("consumers: each overlay config entry must be a map.");

    for (const { key, value } of targetOptions) entry.setIn(["options", key], parse(value));
  }

  // The template's list is indented under `targets`, and the YAML writer starts at the margin.
  const indent = /^[ ]*/.exec(entries)?.[0] ?? "";

  return document
    .toString()
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? line : `${indent}${line}`))
    .join("\n");
}

function keepAsWritten(entries: string): string {
  return entries;
}

function withoutValidatorsLinks(entries: string): string {
  return entries
    .split("\n")
    .filter((line) => !VALIDATORS_LINK_LINE.test(line))
    .join("\n");
}

function addPackageEntries(entriesFile: string, manifestFile: string): void {
  if (!existsSync(entriesFile)) return;

  const entries: unknown = JSON.parse(readFileSync(entriesFile, "utf8"));

  if (!isVersionMap(entries)) {
    throw new Error(
      `consumers: ${entriesFile} must be a JSON object of package names to version strings.`,
    );
  }

  addDependencies(manifestFile, entries);
}

function addDependencies(manifestFile: string, entries: Readonly<Record<string, string>>): void {
  const manifest: ConsumerManifest = JSON.parse(readFileSync(manifestFile, "utf8"));

  manifest.dependencies = { ...manifest.dependencies, ...entries };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isVersionMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((version) => typeof version === "string")
  );
}

// Lists every tarball as a dependency and maps every `@seampact/*` to its tarball, so the packages' own
// dependencies on each other resolve to the same files, one copy each (ADR 0011 "Unpublished installs").
export function useTarballs(directory: string, tarballs: ReadonlyMap<string, string>): void {
  const manifestFile = join(directory, PACKAGE_FILE);
  const manifest: ConsumerManifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const specifiers = Object.fromEntries(
    [...tarballs].map(([name, file]) => [name, `file:./${VENDOR_DIRECTORY}/${file}`]),
  );

  manifest.dependencies = { ...manifest.dependencies, ...specifiers };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const settingsFile = join(directory, PNPM_SETTINGS_FILE);
  const existing = existingWorkspaceSettings(settingsFile);

  // Merged into the app's own settings: a starter's `allowBuilds` and overrides stay.
  writeFileSync(
    settingsFile,
    stringify({
      ...existing,
      allowBuilds: { ...recordOf(existing.allowBuilds), ...ALLOWED_BUILDS },
      overrides: { ...recordOf(existing.overrides), ...specifiers },
    }),
  );
}

function existingWorkspaceSettings(settingsFile: string): WorkspaceSettings {
  if (!existsSync(settingsFile)) return {};

  const parsed: unknown = parse(readFileSync(settingsFile, "utf8"));

  return recordOf(parsed);
}

function recordOf(value: unknown): WorkspaceSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
