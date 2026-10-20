import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  SMOKE_PACKAGE,
  SMOKE_TAMPERED_PACKAGE,
  SMOKE_VERSION,
  type SmokeBundles,
  writeSmokeBundles,
} from "./bundles.ts";
import { type BundleRepository, createBundleRepository } from "./git-repository.ts";
import { type ReleaseServer, startReleaseServer } from "./https-server.ts";
import type { LoopbackServer } from "./loopback.ts";
import { packNpmPackage, startRegistry } from "./registry.ts";

// The three channels serving the reference bundle and its tampered copy: the npm registry, the release server
// and the git repository, as the smoke tests and `cli.ts serve` use them.

export const RELEASE_PATH = "/tasks-contract.tgz";
export const RELEASE_TAMPERED_PATH = "/tasks-contract-tampered.tgz";

export interface SmokeChannels {
  readonly bundles: SmokeBundles;
  readonly registry: LoopbackServer;
  readonly release: ReleaseServer;
  readonly git: BundleRepository;
  close(): Promise<void>;
}

/** Writes the bundles under `work` and starts every channel. */
export async function serveSmokeChannels(work: string): Promise<SmokeChannels> {
  mkdirSync(work, { recursive: true });

  const bundles = await writeSmokeBundles(join(work, "bundles"));
  const registry = await startRegistry([
    {
      name: SMOKE_PACKAGE,
      version: SMOKE_VERSION,
      tarball: await packNpmPackage(bundles.npmPackage, work),
    },
    {
      name: SMOKE_TAMPERED_PACKAGE,
      version: SMOKE_VERSION,
      tarball: await packNpmPackage(bundles.tamperedNpmPackage, work),
    },
  ]);
  const release = await startReleaseServer(
    work,
    new Map([
      [RELEASE_PATH, bundles.tarball],
      [RELEASE_TAMPERED_PATH, bundles.tamperedTarball],
    ]),
  );
  const git = createBundleRepository(work, bundles.directory, bundles.tamperedDirectory);

  return {
    bundles,
    registry,
    release,
    git,
    close: async () => {
      await registry.close();
      await release.close();
    },
  };
}
