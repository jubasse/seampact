import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BundleFailure, BundleManifest } from "@seampact/spec/bundle";
import type { PipelineResult } from "../pipeline/orchestrator.js";
import { type BundleBuildOptions, buildBundle } from "./build.js";
import { bundleEntries } from "./contents.js";
import { bundleTarball } from "./tarball-write.js";

// `seampact bundle`'s library half: the workspace bundled (`buildBundle`) and written as a directory, or as the
// reproducible tarball the release-asset channel serves. Nothing is written when the bundle cannot be made.

/** A new or empty directory, or the tarball file to write (its directory is created). */
export type BundleOutput = { readonly directory: string } | { readonly tarball: string };

export interface BundleWriteOptions extends BundleBuildOptions {
  readonly output: BundleOutput;
}

export type BundleWriteResult =
  | { readonly ok: true; readonly manifest: BundleManifest }
  | {
      readonly ok: false;
      readonly failures: readonly BundleFailure[];
      readonly compiled?: PipelineResult;
    };

export function writeBundle(options: BundleWriteOptions): BundleWriteResult {
  const output = options.output;

  if ("directory" in output && !isNewOrEmpty(output.directory))
    return {
      ok: false,
      failures: [
        {
          code: "bundle.output-not-empty",
          message: `The output directory '${output.directory}' is not empty; a bundle directory holds the bundle's files only.`,
          fix: "Name a new or empty directory, or remove this one first.",
          file: output.directory,
        },
      ],
    };

  const built = buildBundle(options);

  if (!built.ok) return built;

  if ("tarball" in output) {
    mkdirSync(dirname(output.tarball), { recursive: true });
    writeFileSync(output.tarball, bundleTarball(built.contents));
  } else {
    for (const entry of bundleEntries(built.contents)) {
      const target = join(output.directory, ...entry.path.split("/"));

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes, { flag: "wx" });
    }
  }

  return { ok: true, manifest: built.contents.manifest };
}

function isNewOrEmpty(directory: string): boolean {
  return !existsSync(directory) || readdirSync(directory).length === 0;
}
