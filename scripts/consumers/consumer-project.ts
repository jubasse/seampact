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

// The file that marks a directory as a consumer this script made, holding the monorepo commit it was built from.
export const COMMIT_FILE = ".seampact-commit";

/** A target id names one directory under `targets/`: lowercase letters, digits and dashes. */
export const TARGET_ID = /^[a-z0-9-]+$/;

export const VENDOR_DIRECTORY = "vendor/seampact";

// Config entries an overlay appends to the template config's `targets` list, as YAML list items.
const CONFIG_ENTRIES_FILE = "seampact.config.entries.yaml";
const CONFIG_FILE = "seampact.config.yaml";
const PACKAGE_FILE = "package.json";
const CONTRACT_DIRECTORY = "contract";

// pnpm 10 and later read `overrides` from the workspace file only, not from the `pnpm` field of package.json.
const PNPM_SETTINGS_FILE = "pnpm-workspace.yaml";

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

// The template, the target overlay copied over it (its config entries appended), and the reference contract.
export function assembleConsumer(options: {
  readonly consumersRoot: string;
  readonly repositoryRoot: string;
  readonly target: string;
  readonly directory: string;
  readonly commit: string;
}): void {
  const { consumersRoot, directory } = options;

  if (!TARGET_ID.test(options.target)) {
    throw new Error(
      `consumers: target '${options.target}' is not a target id; it must match ${TARGET_ID.source}.`,
    );
  }

  const overlay = join(consumersRoot, "targets", options.target);

  if (!existsSync(overlay)) {
    const known = readdirSync(join(consumersRoot, "targets")).sort().join(", ");

    throw new Error(
      `consumers: no overlay for target '${options.target}'; known targets: ${known}.`,
    );
  }

  cpSync(join(consumersRoot, "template"), directory, { recursive: true });
  cpSync(overlay, directory, {
    recursive: true,
    filter: (source) => !source.endsWith(CONFIG_ENTRIES_FILE),
  });
  appendConfigEntries(join(overlay, CONFIG_ENTRIES_FILE), join(directory, CONFIG_FILE));
  cpSync(join(options.repositoryRoot, "fixtures/reference"), join(directory, CONTRACT_DIRECTORY), {
    recursive: true,
  });
  writeFileSync(join(directory, COMMIT_FILE), `${options.commit}\n`);
}

// The template config ends with its `targets` list, so the overlay's items extend it.
function appendConfigEntries(entriesFile: string, configFile: string): void {
  if (!existsSync(entriesFile)) return;

  const config = readFileSync(configFile, "utf8").trimEnd();

  writeFileSync(configFile, `${config}\n${readFileSync(entriesFile, "utf8").trimEnd()}\n`);
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

  const overrides = Object.entries(specifiers).map(
    ([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`,
  );

  writeFileSync(join(directory, PNPM_SETTINGS_FILE), `overrides:\n${overrides.join("\n")}\n`);
}
