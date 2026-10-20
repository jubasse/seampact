import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { loadBundleWriter } from "./compiler.ts";

// The bundles the channels serve: the reference contract's bundle as a directory, an npm package and a tarball,
// and a tampered copy of each with one source byte changed under an untouched manifest.

export const REFERENCE_WORKSPACE = join(REPO_ROOT, "fixtures/reference");
export const SMOKE_PACKAGE = "tasks-contract";
export const SMOKE_TAMPERED_PACKAGE = "tasks-contract-tampered";
export const SMOKE_VERSION = "1.0.0";
/** The bundle file the tampered copies change. */
export const SMOKE_TAMPERED_FILE = "sources/workspace.yaml";

const MANIFEST_FILE = "seampact-bundle.json";
const NPM_PACKAGE_MANIFEST = "package.json";

export interface SmokeBundles {
  readonly integrity: string;
  readonly directory: string;
  readonly tamperedDirectory: string;
  readonly npmPackage: string;
  readonly tamperedNpmPackage: string;
  readonly tarball: Uint8Array;
  readonly tamperedTarball: Uint8Array;
}

/** Writes every bundle form under `work`. */
export async function writeSmokeBundles(work: string): Promise<SmokeBundles> {
  const writer = await loadBundleWriter();
  const contract = { name: SMOKE_PACKAGE, version: SMOKE_VERSION };
  const directory = join(work, "bundle");
  const npmPackage = join(work, "npm", SMOKE_PACKAGE);
  const tarballFile = join(work, "bundle.tgz");

  const integrity = writer.write(REFERENCE_WORKSPACE, contract, { directory });

  writer.write(REFERENCE_WORKSPACE, contract, { npmPackage });
  writer.write(REFERENCE_WORKSPACE, contract, { tarball: tarballFile });

  const tamperedDirectory = join(work, "bundle-tampered");
  const tamperedNpmPackage = join(work, "npm", SMOKE_TAMPERED_PACKAGE);

  cpSync(directory, tamperedDirectory, { recursive: true });
  tamperFile(tamperedDirectory);
  cpSync(npmPackage, tamperedNpmPackage, { recursive: true });
  tamperFile(tamperedNpmPackage);
  renameNpmPackage(tamperedNpmPackage, SMOKE_TAMPERED_PACKAGE);

  return {
    integrity,
    directory,
    tamperedDirectory,
    npmPackage,
    tamperedNpmPackage,
    tarball: new Uint8Array(readFileSync(tarballFile)),
    tamperedTarball: writer.tarball(bundleContents(tamperedDirectory)),
  };
}

// Flips the low bit of the file's first byte: same size, another SHA-256.
export function tamperFile(bundleDirectory: string): void {
  const file = join(bundleDirectory, ...SMOKE_TAMPERED_FILE.split("/"));
  const bytes = readFileSync(file);

  bytes[0] = (bytes[0] ?? 0) ^ 1;
  writeFileSync(file, bytes);
}

function renameNpmPackage(directory: string, name: string): void {
  const file = join(directory, NPM_PACKAGE_MANIFEST);
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));

  writeFileSync(file, `${JSON.stringify({ ...Object(manifest), name }, null, 2)}\n`);
}

// The directory's manifest and listed files, as the tarball writer takes them.
function bundleContents(directory: string): { manifest: object; files: Map<string, Uint8Array> } {
  const manifest: unknown = JSON.parse(readFileSync(join(directory, MANIFEST_FILE), "utf8"));
  const listed: unknown = Reflect.get(Object(manifest), "files");
  const files = new Map<string, Uint8Array>();

  if (!Array.isArray(listed)) throw new Error(`${directory}: the manifest lists no files`);

  for (const entry of listed) {
    const path: unknown = Reflect.get(Object(entry), "path");

    if (typeof path !== "string")
      throw new Error(`${directory}: a manifest file entry has no path`);

    files.set(path, new Uint8Array(readFileSync(join(directory, ...path.split("/")))));
  }

  return { manifest: Object(manifest), files };
}
