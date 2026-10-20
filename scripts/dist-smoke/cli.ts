import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  SMOKE_PACKAGE,
  SMOKE_TAMPERED_FILE,
  SMOKE_TAMPERED_PACKAGE,
  SMOKE_VERSION,
} from "./bundles.ts";
import { RELEASE_PATH, RELEASE_TAMPERED_PATH, serveSmokeChannels } from "./channels.ts";
import { SMOKE_GIT_DIRECTORY, SMOKE_GIT_TAG, SMOKE_GIT_TAMPERED_TAG } from "./git-repository.ts";

// node --experimental-transform-types --import ./scripts/ir-models/register.ts scripts/dist-smoke/cli.ts serve [--work <dir>]
// Serves the three channels for the native smoke legs and prints what to fetch as one JSON line.

const USAGE = "usage: cli.ts serve [--work <dir>]";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { work: { type: "string" } },
});

if (positionals.length !== 1 || positionals[0] !== "serve") {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const work = values.work ?? mkdtempSync(join(tmpdir(), "seampact-dist-smoke-"));
const channels = await serveSmokeChannels(work);

process.stdout.write(
  `${JSON.stringify({
    integrity: channels.bundles.integrity,
    tamperedFile: SMOKE_TAMPERED_FILE,
    npm: {
      registry: channels.registry.url,
      package: SMOKE_PACKAGE,
      tamperedPackage: SMOKE_TAMPERED_PACKAGE,
      version: SMOKE_VERSION,
    },
    release: {
      url: `${channels.release.url}${RELEASE_PATH}`,
      tamperedUrl: `${channels.release.url}${RELEASE_TAMPERED_PATH}`,
      caFile: channels.release.caFile,
    },
    git: {
      url: channels.git.url,
      tag: SMOKE_GIT_TAG,
      tamperedTag: SMOKE_GIT_TAMPERED_TAG,
      directory: SMOKE_GIT_DIRECTORY,
    },
  })}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void channels.close().then(() => process.exit(0));
  });
