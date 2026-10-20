// A file of a package resolved from a `node_modules` at or above the workspace root (the loader's pack walk): the
// package directory, then the path inside the package.
import { BUNDLE_PACKS_DIRECTORY, BUNDLE_SOURCES_DIRECTORY } from "@seampact/spec/bundle";

export const PACK_FILE = /^((?:\.\.\/)*node_modules\/(?:@[^/]+\/)?[^/]+)\/(.+)$/u;

// The bundle's packs directory below its sources directory: `.packs`.
const PACKS_DIRECTORY_IN_SOURCES = BUNDLE_PACKS_DIRECTORY.slice(
  `${BUNDLE_SOURCES_DIRECTORY}/`.length,
);

/** The directory that holds a pack's files wherever the package manager installed it: `.packs/<name>@<version>`. */
export function packVendoredDirectory(name: string, version: string): string {
  return `${PACKS_DIRECTORY_IN_SOURCES}/${name}@${version}`;
}

/** The package name and the path inside the package of a pack file, or undefined for a file in no pack package. */
export function packFileParts(file: string): { name: string; inside: string } | undefined {
  const match = PACK_FILE.exec(file);

  if (match === null) return undefined;

  const [, packageDirectory = "", inside = ""] = match;

  return { name: packageNameOf(packageDirectory), inside };
}

/** The package name of a pack package directory (`../node_modules/@acme/pack-a` gives `@acme/pack-a`). */
export function packageNameOf(packageDirectory: string): string {
  return packageDirectory.slice(
    packageDirectory.lastIndexOf("node_modules/") + "node_modules/".length,
  );
}

/** A pack file as the bundle vendors it and the side table names it: `.packs/<name>@<version>/<inside>`. */
export function packVendoredFile(name: string, version: string, inside: string): string {
  return `${packVendoredDirectory(name, version)}/${inside}`;
}

export const PACK_LAYER_PREFIX = "pack:";

/** A pack's layer id, `pack:<name>`. */
export function packLayerIdOf(name: string): `pack:${string}` {
  return `${PACK_LAYER_PREFIX}${name}`;
}
