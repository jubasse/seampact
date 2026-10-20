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

// A scope, right or rule answers a parent or a subject: its 404 sits beside the member 404 on purpose.
const SUBJECT_DERIVATIONS: ReadonlySet<string> = new Set([
  "scope.errors",
  "requirement.errors",
  "rule.bucket",
]);
const EVERY_DERIVATION = "conventions.every";

interface CompetingRoutes {
  operations: Operation[];
  attachedByEveryOnly: boolean;
}

function attachedForTheMember(operation: Operation, code: string): boolean {
  return operation.errors.some(
    (error) =>
      error.code === code &&
      (error.derivedFrom === undefined || !SUBJECT_DERIVATIONS.has(error.derivedFrom.derivation)),
  );
}

function attachedByEveryOnly(operation: Operation, code: string): boolean {
  return operation.errors
    .filter((error) => error.code === code)
    .every((error) => error.derivedFrom?.derivation === EVERY_DERIVATION);
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
        !takesNotFoundRole(operation, code) &&
        attachedForTheMember(operation, code)
      );
    });
}

function fixOf(code: string, routes: CompetingRoutes): string {
  const binding = routes.attachedByEveryOnly
    ? `Set conventions.errors.derived.notFound to ${code}`
    : `Add errorRoles: { notFound: ${code} } on the member node of the collection that lists '${code}'`;

  return `${binding}, or allow seampact/not-found-role on the catalogue entry with a reason.`;
}

export const notFoundRole: LintRuleDefinition = {
  name: "not-found-role",
  defaultSeverity: "warning",
  reports: "a declared 404 code beside the derived notFound code on a route (section 11)",
  silencedOn: "the catalogue entry",
  check({ ir, report }) {
    const routesByCode = new Map<string, CompetingRoutes>();

    for (const operation of ir.operations) {
      for (const code of competingCodes(ir, operation)) {
        const known = routesByCode.get(code);

        routesByCode.set(code, {
          operations: [...(known?.operations ?? []), operation],
          attachedByEveryOnly:
            (known?.attachedByEveryOnly ?? true) && attachedByEveryOnly(operation, code),
        });
      }
    }

    for (const [code, routes] of routesByCode) {
      const origin = ir.errors[code]?.origin;

      if (origin === undefined) continue;

      report({
        message: `The 404 code '${code}' is listed on ${lintRoutesNamed(routes.operations)}, which also ${routes.operations.length === 1 ? "answers" : "answer"} the derived notFound code, so they have two 404 codes.`,
        fix: fixOf(code, routes),
        origin,
        allowAt: [origin],
      });
    }
  },
};
