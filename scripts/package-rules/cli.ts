import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackageRules, formatViolation } from "./rules.ts";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const violations = checkPackageRules(root);
for (const v of violations) console.error(formatViolation(v));
console.error(
  violations.length === 0
    ? "package rules: ok"
    : `package rules: ${violations.length} violation(s)`,
);
process.exitCode = violations.length === 0 ? 0 : 1;
