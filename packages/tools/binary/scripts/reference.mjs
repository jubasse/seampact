// Writes the reference output the smoke compares against: the IR, the bundle and the editor schemas of each smoke app, made by the Node CLI
// (the CLI entry bundled for Node, packs resolved from the repository's node_modules).
// Usage: node scripts/reference.mjs <out-dir>
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { repositoryRoot, runSmokeApp, SMOKE_APPS, writeSmokeApp } from "./smoke-apps.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, "dist/reference"));
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

  mkdirSync(join(out, app.name), { recursive: true });
  writeFileSync(join(out, app.name, "steps.json"), `${JSON.stringify(steps, null, 2)}\n`);

  for (const [file, bytes] of Object.entries(writtenFiles)) {
    mkdirSync(dirname(join(out, app.name, file)), { recursive: true });
    writeFileSync(join(out, app.name, file), bytes);
  }

  console.log(`reference: ${app.name} ok`);
}
