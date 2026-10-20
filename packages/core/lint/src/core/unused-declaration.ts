import type { LintRuleDefinition } from "../plugin.js";
import { lintOwnsOrigin } from "./origins.js";

// The layers the contract's authors own, less `shared`: the runner sees one api, and a shared file, like a pack,
// offers entries to every api of the workspace, so one api not using an entry is no defect. A shared entry no api
// uses needs a workspace-level input before it can be reported.
const AUTHORED_LAYERS: ReadonlySet<string> = new Set(["api", "base"]);

export const unusedDeclaration: LintRuleDefinition = {
  name: "unused-declaration",
  defaultSeverity: "warning",
  reports: "a declaration no operation, identity or convention reaches (ADR 0004 section 2)",
  silencedOn: "the catalogue entry",
  check({ declared, report }) {
    for (const entry of declared) {
      if (entry.reached || !AUTHORED_LAYERS.has(entry.origin.layer)) continue;

      if (!lintOwnsOrigin(entry.origin)) continue;
      report({
        message: `The declaration '${entry.id}' in ${entry.catalogue} is reached by no operation, identity or convention.`,
        fix: `Remove '${entry.id}', use it, or allow seampact/unused-declaration on it with a reason.`,
        origin: entry.origin,
        allowAt: [entry.origin],
      });
    }
  },
};
