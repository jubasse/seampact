import type { ContractIR, Operation } from "@seampact/spec/ir";
import type { LintRuleDefinition } from "../plugin.js";
import { lintGroupByOrigin, lintNodeOf, lintOwnsOrigin, lintRoutesNamed } from "./origins.js";

// The maturity an operation derives when it states none (grammar 10): its owning service's, else the api's.
function derivedLevel(ir: ContractIR, operation: Operation): string {
  const owner = operation.upstream[0];
  const service =
    owner === undefined || !Object.hasOwn(ir.services, owner) ? undefined : ir.services[owner];

  return service?.maturity ?? ir.api.maturity;
}

export const redundantMaturity: LintRuleDefinition = {
  name: "redundant-maturity",
  defaultSeverity: "warning",
  reports: "a stated maturity equal to the derived one (section 10)",
  silencedOn: "the node",
  check({ ir, report }) {
    const redundant = ir.operations
      .filter(
        (operation) =>
          operation.maturity.source === "stated" &&
          lintOwnsOrigin(operation.maturity.origin) &&
          operation.maturity.level === derivedLevel(ir, operation),
      )
      .map((operation) => ({ origin: operation.maturity.origin, operation }));

    for (const { origin, entries } of lintGroupByOrigin(redundant)) {
      const operations = entries.map((entry) => entry.operation);
      const level = operations[0]?.maturity.level;

      report({
        message: `The maturity '${level}' written for ${lintRoutesNamed(operations)} equals the derived maturity.`,
        fix: "Remove the maturity, or allow seampact/redundant-maturity on its node with a reason.",
        origin,
        allowAt: [lintNodeOf(origin)],
      });
    }
  },
};
