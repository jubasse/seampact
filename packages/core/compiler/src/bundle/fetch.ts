import { existsSync, rmSync } from "node:fs";
import type { BundleManifest } from "@seampact/spec/bundle";
import type { BundleSource, ReleaseBundleSource } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import { bundleCacheDirectory, bundleCacheEntry, storeBundleCacheEntry } from "./cache.js";
import type { BundleSourceFailure } from "./fetch-failure.js";
import { fetchGitBundle, gitSourceProblem } from "./fetch-git.js";
import { installedBundlePackage } from "./fetch-package.js";
import { downloadReleaseTarball } from "./fetch-release.js";
import type { LocalSourcePolicy } from "./local-sources.js";
import { extractBundleTarball } from "./tarball-read.js";
import { type BundleChannel, verifyBundle } from "./verify.js";

// A bundle source fetched from its channel and put through the pinned-bundle check, so its IR is read with no
// compiler run (ADR 0011). A release or git bundle is cached by its pinned integrity once it passed, and the check
// runs again on every cache read; an installed package is read where it is, checked every time.

export interface BundleFetchOptions {
  /** Where a `package` source is resolved from and a local git path is relative to. */
  readonly baseDirectory: string;
  /** Whether a local git repository (`file:` or a path) may be fetched. */
  readonly localSources: LocalSourcePolicy;
  /** The cache root; `bundleCacheDirectory(process.env)` when absent. */
  readonly cacheDirectory?: string;
}

export type BundleFetchResult =
  | {
      readonly ok: true;
      readonly manifest: BundleManifest;
      readonly integrity: string;
      /** Each api's IR by api name. */
      readonly irs: ReadonlyMap<string, ContractIR>;
    }
  | {
      readonly ok: false;
      readonly failures: readonly BundleSourceFailure[];
      /** The bundle's recomputed integrity, once its files passed: the value to pin. */
      readonly integrity?: string;
    };

/** Fetches the bundle `source` names and checks it against its `integrity`. */
export async function fetchBundle(
  source: BundleSource,
  options: BundleFetchOptions,
): Promise<BundleFetchResult> {
  if ("package" in source) {
    const directory = installedBundlePackage(source, options.baseDirectory);

    if (typeof directory !== "string") return { ok: false, failures: [directory] };

    return verifyBundle(directory, source.integrity, { channel: "package" });
  }

  const channel: BundleChannel = "release" in source ? "release" : "git";
  const problem = "git" in source ? gitSourceProblem(source, options.localSources) : undefined;

  if (problem !== undefined) return { ok: false, failures: [problem] };

  const cacheEntry =
    source.integrity === undefined
      ? undefined
      : bundleCacheEntry(
          options.cacheDirectory ?? bundleCacheDirectory(process.env),
          source.integrity,
        );

  if (cacheEntry !== undefined && existsSync(cacheEntry))
    return readCacheEntry(cacheEntry, source.integrity, channel);

  const fetched =
    "release" in source
      ? await fetchRelease(source)
      : await fetchGitBundle(source, options.baseDirectory, options.localSources);

  if (!fetched.ok) return { ok: false, failures: [fetched.failure] };

  try {
    const verified = verifyBundle(fetched.directory, source.integrity, { channel });

    if (verified.ok && cacheEntry !== undefined)
      storeBundleCacheEntry(fetched.directory, cacheEntry);

    return verified;
  } finally {
    fetched.remove();
  }
}

type Fetched =
  | { readonly ok: true; readonly directory: string; readonly remove: () => void }
  | { readonly ok: false; readonly failure: BundleSourceFailure };

async function fetchRelease(source: ReleaseBundleSource): Promise<Fetched> {
  const tarball = await downloadReleaseTarball(source);

  if (!(tarball instanceof Uint8Array)) return { ok: false, failure: tarball };

  const extracted = extractBundleTarball(tarball);

  if (!extracted.ok) return { ok: false, failure: firstFailure(extracted.failures) };

  const directory = extracted.directory;

  return { ok: true, directory, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

// The archive reader refuses a tarball on its first problem.
function firstFailure(failures: readonly BundleSourceFailure[]): BundleSourceFailure {
  const [failure] = failures;

  if (failure === undefined)
    throw new Error("bundle: the archive reader refused a tarball without a failure.");

  return failure;
}

// A cache entry is checked again on every read; one that fails names itself, since only removing it heals it.
function readCacheEntry(
  entry: string,
  integrity: string | undefined,
  channel: BundleChannel,
): BundleFetchResult {
  const verified = verifyBundle(entry, integrity, { channel });

  if (verified.ok) return verified;

  return {
    ...verified,
    failures: [
      {
        code: "bundle.cache-invalid",
        message: `The cached bundle at ${entry} fails the pinned-bundle check; it was changed after it was cached.`,
        fix: `Remove ${entry}, then run again to fetch the bundle afresh.`,
        file: entry,
      },
      ...verified.failures,
    ],
  };
}
