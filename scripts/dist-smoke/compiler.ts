import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The bundle writer, read through a dynamic import as `scripts/golden/compiler.ts` reads the compiler: the root
// TypeScript project cannot import the compiler's sources statically. The adapter names the members it calls and
// checks them at run time.

const COMPILER_ENTRY = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../packages/core/compiler/src/index.ts",
);

export type BundleOutput = { directory: string } | { npmPackage: string } | { tarball: string };

export interface BundleContents {
  manifest: object;
  files: ReadonlyMap<string, Uint8Array>;
}

export interface BundleWriter {
  /** Bundles the workspace at `root` and returns the bundle's integrity; throws naming every failure. */
  write(root: string, contract: { name: string; version: string }, output: BundleOutput): string;
  tarball(contents: BundleContents): Uint8Array;
}

interface CompilerModule {
  loadFsReader(root: string): object;
  writeBundle(options: object): unknown;
  bundleTarball(contents: BundleContents): Uint8Array;
}

const COMPILER_FUNCTIONS = ["loadFsReader", "writeBundle", "bundleTarball"];

const WORKSPACE_ENTRY = "workspace.yaml";

function isCompilerModule(value: unknown): value is CompilerModule {
  if (typeof value !== "object" || value === null) return false;

  return COMPILER_FUNCTIONS.every(
    (name) => name in value && typeof Reflect.get(value, name) === "function",
  );
}

function writtenIntegrity(result: unknown, root: string): string {
  const manifest =
    typeof result === "object" && result !== null ? Reflect.get(result, "manifest") : undefined;
  const integrity =
    typeof manifest === "object" && manifest !== null
      ? Reflect.get(manifest, "integrity")
      : undefined;

  if (typeof integrity === "string") return integrity;

  throw new Error(`bundling ${root} failed: ${JSON.stringify(result)}`);
}

/** The compiler's bundle writer, loaded once. */
export async function loadBundleWriter(): Promise<BundleWriter> {
  const loaded: unknown = await import(pathToFileURL(COMPILER_ENTRY).href);

  if (!isCompilerModule(loaded))
    throw new Error(`${COMPILER_ENTRY} does not export the members the smoke harness calls`);

  return {
    write: (root, contract, output) =>
      writtenIntegrity(
        loaded.writeBundle({
          reader: loaded.loadFsReader(root),
          entry: WORKSPACE_ENTRY,
          contract,
          output,
        }),
        root,
      ),
    tarball: (contents) => loaded.bundleTarball(contents),
  };
}
