// node scripts/package-rules/cli.ts [<root>] [--release]
// `--release` checks the stamped form of a release; release.yml alone passes it, after the stamp.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PUBLISHED_PACKAGES } from "../release/npm-versions.ts";
import { checkPackageRules, DEVELOPMENT_MODE, formatViolation } from "./rules.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { release: { type: "boolean", default: false } },
});

const root = resolve(positionals[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const mode = values.release
  ? { kind: "release" as const, publishedPackages: PUBLISHED_PACKAGES }
  : DEVELOPMENT_MODE;
const violations = checkPackageRules(root, mode);

for (const v of violations) console.error(formatViolation(v));
console.error(
  violations.length === 0
    ? `package rules (${mode.kind}): ok`
    : `package rules (${mode.kind}): ${violations.length} violation(s)`,
);
process.exitCode = violations.length === 0 ? 0 : 1;
