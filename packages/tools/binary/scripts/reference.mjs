// Writes the reference output the smoke compares against: the IR, the bundle and the editor schemas of each smoke app,
// the OpenAPI documents of the native app, and every file each `init` run leaves, made by the Node CLI
// (the CLI entry bundled for Node, packs resolved from the repository's node_modules). With `--packed-packs`, the
// packs are installed from their npm tarballs beside the apps, as a release binary embeds them.
// Usage: node scripts/reference.mjs [<out-dir>] [--packed-packs <tarball-dir>]
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { extractPackedPacks } from "./packed-packs.mjs";
import {
  INIT_RUNS,
  NATIVE_APP,
  repositoryRoot,
  runInit,
  runNativeApp,
  runSmokeApp,
  SMOKE_APPS,
  writeSmokeApp,
} from "./smoke-apps.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { "packed-packs": { type: "string" } },
});
const out = resolve(positionals[0] ?? join(root, "dist/reference"));
// Inside the repository, so the pack walk reaches its node_modules.
const appsRoot = join(root, "dist/reference-apps");
const nodeCli = join(root, "dist/node-cli.mjs");

await build({
  absWorkingDir: root,
  entryPoints: [join(repositoryRoot, "packages/core/cli/src/bin.ts")],
  outfile: nodeCli,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
  },
  logLevel: "warning",
});
rmSync(appsRoot, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });

if (options["packed-packs"] !== undefined) installPackedPacks(resolve(options["packed-packs"]));

for (const app of SMOKE_APPS) {
  const appDirectory = join(appsRoot, app.name);

  writeSmokeApp(app, appDirectory);

  const { steps, writtenFiles } = runSmokeApp({
    executable: process.execPath,
    prefixArguments: [nodeCli],
    environment: process.env,
    app,
    directory: appDirectory,
  });

  if (steps["compile --out ir"].status !== 0) {
    console.error(`reference: ${app.name} did not compile\n${steps["compile --out ir"].stderr}`);
    process.exit(1);
  }

  writeReference(app.name, steps, writtenFiles);
}

const nativeReference = runNativeApp({
  executable: process.execPath,
  prefixArguments: [nodeCli],
  environment: process.env,
  config: NATIVE_APP.referenceConfig,
  directory: join(appsRoot, NATIVE_APP.name),
});
const nativeFailed = Object.entries(nativeReference.steps).find(
  ([, answer]) => answer.status !== 0,
);

if (nativeFailed !== undefined) {
  console.error(
    `reference: ${NATIVE_APP.name}: '${nativeFailed[0]}' failed\n${nativeFailed[1].stderr}`,
  );
  process.exit(1);
}

writeReference(NATIVE_APP.name, nativeReference.steps, nativeReference.writtenFiles);

// Outside the repository, as the binary's smoke runs them: init writes a new project with no config above it.
const initRoot = mkdtempSync(join(tmpdir(), "seampact-reference-init-"));

for (const run of INIT_RUNS) {
  const { steps, writtenFiles } = runInit({
    executable: process.execPath,
    prefixArguments: [nodeCli],
    environment: process.env,
    run,
    directory: join(initRoot, run.name),
  });
  const failed = Object.entries(steps).find(([, answer]) => answer.status !== 0);

  if (failed !== undefined) {
    console.error(`reference: ${run.name}: '${failed[0]}' failed\n${failed[1].stderr}`);
    process.exit(1);
  }

  writeReference(run.name, steps, writtenFiles);
}

rmSync(initRoot, { recursive: true, force: true });

// The pack walk meets the apps' own node_modules before the repository's, so the packed files win.
function installPackedPacks(tarballDirectory) {
  const extractedRoot = mkdtempSync(join(tmpdir(), "seampact-reference-packs-"));
  const fail = (message) => {
    console.error(`reference: ${message}`);
    process.exit(1);
  };

  for (const [packName, packageDirectory] of extractPackedPacks(
    tarballDirectory,
    extractedRoot,
    fail,
  )) {
    cpSync(packageDirectory, join(appsRoot, "node_modules", packName), { recursive: true });
  }

  rmSync(extractedRoot, { recursive: true, force: true });
  console.log(`reference: packs installed from the npm tarballs in ${tarballDirectory}`);
}

function writeReference(name, steps, writtenFiles) {
  mkdirSync(join(out, name), { recursive: true });
  writeFileSync(join(out, name, "steps.json"), `${JSON.stringify(steps, null, 2)}\n`);

  for (const [file, bytes] of Object.entries(writtenFiles)) {
    mkdirSync(dirname(join(out, name, file)), { recursive: true });
    writeFileSync(join(out, name, file), bytes);
  }

  console.log(`reference: ${name} ok`);
}
