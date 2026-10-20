// A file of a package resolved from a `node_modules` at or above the workspace root (the loader's pack walk): the
// package directory, then the path inside the package.
export const PACK_FILE = /^((?:\.\.\/)*node_modules\/(?:@[^/]+\/)?[^/]+)\/(.+)$/u;

/** The directory that holds a pack's files wherever the package manager installed it: `.packs/<name>@<version>`. */
export function packVendoredDirectory(name: string, version: string): string {
  return `.packs/${name}@${version}`;
}
