import type { ContractIR } from "@seampact/spec/ir";
import type { LintDeclared, LintRuleDefinition } from "../plugin.js";
import { lintOwnsOrigin } from "./origins.js";

// The catalogues the IR holds, by the name the grammar gives them. `requirements` is left out: its entries expand
// into each route's `requires`, so the IR cannot tell a used one from an unused one.
const CATALOGUES: ReadonlySet<string> = new Set([
  "schemas",
  "enums",
  "scalars",
  "errors",
  "natures",
  "schemes",
  "headers",
  "identities",
  "rights",
  "rules",
  "scopes",
  "buckets",
  "services",
  "pagings",
  "formats",
]);

// The layers the contract's authors own; a pack offers entries it does not expect every api to use.
const AUTHORED_LAYERS: ReadonlySet<string> = new Set(["api", "shared", "base"]);

function irHolds(ir: ContractIR, declared: LintDeclared): boolean {
  const entries: unknown = Reflect.get(ir, declared.catalogue);

  return typeof entries === "object" && entries !== null && Object.hasOwn(entries, declared.id);
}

// A convention value names a declaration by its id, as `conventions.paging.default` names a paging style.
function conventionNames(ir: ContractIR, id: string): boolean {
  return Object.values(ir.conventions).some(({ value }) => valueNames(value, id));
}

function valueNames(value: unknown, id: string): boolean {
  if (value === id) return true;

  if (Array.isArray(value)) return value.some((item) => valueNames(item, id));

  if (typeof value === "object" && value !== null)
    return Object.values(value).some((item) => valueNames(item, id));

  return false;
}

export const unusedDeclaration: LintRuleDefinition = {
  name: "unused-declaration",
  defaultSeverity: "warning",
  reports: "a declaration no operation, identity or convention reaches (ADR 0004 section 2)",
  silencedOn: "the catalogue entry",
  check({ ir, declared, report }) {
    for (const entry of declared) {
      if (!CATALOGUES.has(entry.catalogue) || !AUTHORED_LAYERS.has(entry.origin.layer)) continue;

      if (!lintOwnsOrigin(entry.origin) || irHolds(ir, entry) || conventionNames(ir, entry.id))
        continue;
      report({
        message: `The declaration '${entry.id}' in ${entry.catalogue} is reached by no operation, identity or convention.`,
        fix: `Remove '${entry.id}', use it, or allow seampact/unused-declaration on it with a reason.`,
        origin: entry.origin,
        allowAt: [entry.origin],
      });
    }
  },
};
