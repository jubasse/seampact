// Writes the Node reference output the smoke compares against: `node dist/bundle.cjs` on each fixture.
// Usage: node scripts/reference.mjs <out-dir>
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, "dist/reference"));
mkdirSync(out, { recursive: true });
const run = (dir) =>
  spawnSync(process.execPath, [join(root, "dist/bundle.cjs"), dir], { encoding: "buffer" });
const ok = run(join(root, "fixtures/ok"));
const bad = run(join(root, "fixtures/anchor"));
if (ok.status !== 0 || bad.status === 0) {
  console.error("reference: unexpected exit codes", ok.status, bad.status);
  process.exit(1);
}
writeFileSync(join(out, "ok.stdout"), ok.stdout);
writeFileSync(join(out, "anchor.stderr"), bad.stderr);
console.log(ok.stdout.toString());
console.log(bad.stderr.toString());
