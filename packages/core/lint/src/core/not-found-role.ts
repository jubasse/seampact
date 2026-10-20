import type { ContractIR, Operation } from "@seampact/spec/ir";
import type { LintRuleDefinition } from "../plugin.js";
import { lintOwnsOrigin, lintRoutesNamed } from "./origins.js";

const NOT_FOUND_ROLE = "notFound";
const NOT_FOUND_STATUS = 404;

function answersNotFoundRole(operation: Operation): boolean {
  return operation.errors.some((error) =>
    error.roles?.some((binding) => binding.role === NOT_FOUND_ROLE),
  );
}

function takesNotFoundRole(operation: Operation, code: string): boolean {
  return operation.errors.some(
    (error) =>
      error.code === code && error.roles?.some((binding) => binding.role === NOT_FOUND_ROLE),
  );
}

// The 404 codes the contract wrote and that this operation lists beside the code of its notFound role.
function competingCodes(ir: ContractIR, operation: Operation): string[] {
  if (!answersNotFoundRole(operation)) return [];

  return operation.errors
    .map((error) => error.code)
    .filter((code) => {
      const declaration = Object.hasOwn(ir.errors, code) ? ir.errors[code] : undefined;

      return (
        declaration !== undefined &&
        declaration.http.status === NOT_FOUND_STATUS &&
        lintOwnsOrigin(declaration.origin) &&
        !takesNotFoundRole(operation, code)
      );
    });
}

export const notFoundRole: LintRuleDefinition = {
  name: "not-found-role",
  defaultSeverity: "warning",
  reports: "a declared 404 code beside the derived notFound code on a route (section 11)",
  silencedOn: "the catalogue entry",
  check({ ir, report }) {
    const routesByCode = new Map<string, Operation[]>();

    for (const operation of ir.operations) {
      for (const code of competingCodes(ir, operation)) {
        routesByCode.set(code, [...(routesByCode.get(code) ?? []), operation]);
      }
    }

    for (const [code, operations] of routesByCode) {
      const origin = ir.errors[code]?.origin;

      if (origin === undefined) continue;

      report({
        message: `The 404 code '${code}' is listed on ${lintRoutesNamed(operations)}, which also answer the derived notFound code, so they have two 404 codes.`,
        fix: `Add errorRoles: { notFound: ${code} } on the node that lists '${code}', or allow seampact/not-found-role on it with a reason.`,
        origin,
        allowAt: [origin],
      });
    }
  },
};
