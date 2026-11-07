import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BundleFailure, BundleManifest } from "@seampact/spec/bundle";
import type { PipelineResult } from "../pipeline/orchestrator.js";
import { type BundleBuildOptions, buildBundle } from "./build.js";
import { bundleEntries } from "./contents.js";
import { bundleTarball } from "./tarball-write.js";

// `seampact bundle`'s library half: the workspace bundled (`buildBundle`) and written as a directory, or as the
// reproducible tarball the release-asset channel serves. Nothing is written when the bundle cannot be made.

/**
 * A new or empty directory; the same with npm's `package.json` beside the manifest (the bundle directory is the
 * package root, `seampact.role: bundle`), ready for `npm publish`; or the tarball file to write (its directory is
 * created).
 */
export type BundleOutput =
  | { readonly directory: string }
  | { readonly npmPackage: string }
  | { readonly tarball: string };

const NPM_PACKAGE_MANIFEST = "package.json";
const BUNDLE_PACKAGE_ROLE = "bundle";

export interface BundleWriteOptions extends BundleBuildOptions {
  readonly output: BundleOutput;
}

export type BundleWriteResult =
  | {
      readonly ok: true;
      readonly manifest: BundleManifest;
      readonly compiled: PipelineResult;
    }
  | {
      readonly ok: false;
      readonly failures: readonly BundleFailure[];
      readonly compiled?: PipelineResult;
    };

export function writeBundle(options: BundleWriteOptions): BundleWriteResult {
  const output = options.output;
  const target = "tarball" in output ? undefined : directoryOf(output);

  if (target !== undefined && !isNewOrEmpty(target))
    return {
      ok: false,
      failures: [
        {
          code: "bundle.output-not-empty",
          message: `The output directory '${target}' is not empty; a bundle directory holds the bundle's files only.`,
          fix: "Name a new or empty directory, or remove this one first.",
          file: target,
        },
      ],
    };

  const built = buildBundle(options);

  if (!built.ok) return built;

  if ("tarball" in output) {
    mkdirSync(dirname(output.tarball), { recursive: true });
    writeFileSync(output.tarball, bundleTarball(built.contents));

    return { ok: true, manifest: built.contents.manifest, compiled: built.compiled };
  }

  const directory = directoryOf(output);

  for (const entry of bundleEntries(built.contents)) {
    const file = join(directory, ...entry.path.split("/"));

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, entry.bytes, { flag: "wx" });
  }

  if ("npmPackage" in output)
    writeFileSync(
      join(directory, NPM_PACKAGE_MANIFEST),
      npmPackageManifest(built.contents.manifest),
      {
        flag: "wx",
      },
    );

  return { ok: true, manifest: built.contents.manifest, compiled: built.compiled };
}

function directoryOf(output: Exclude<BundleOutput, { readonly tarball: string }>): string {
  return "directory" in output ? output.directory : output.npmPackage;
}

function npmPackageManifest(manifest: BundleManifest): string {
  const { name, version } = manifest.contract;

  return `${JSON.stringify({ name, version, seampact: { role: BUNDLE_PACKAGE_ROLE } }, null, 2)}\n`;
}

function isNewOrEmpty(directory: string): boolean {
  return !existsSync(directory) || readdirSync(directory).length === 0;
}
