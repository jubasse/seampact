import { isKnownVariant, type Operation, type Origin } from "@seampact/spec/ir";
import type { LintRuleDefinition } from "../plugin.js";
import {
  lintGroupByOrigin,
  lintNodeOf,
  lintOriginKey,
  lintOwnsOrigin,
  lintRoutesNamed,
} from "./origins.js";

// The tree of grammar 08: an exception written elsewhere, as the api-wide `conventions.query.unknownKeys`, is a
// convention, not a node, so the rule never reads it.
const TREE_PREFIX = "/surfaces/";

// A surface root is `/surfaces/<name>`; the one place above a route an exception is meant for.
const SURFACE_ROOT = /^\/surfaces\/[^/]+$/;

interface Exception {
  /** The written form, for the message. */
  written: string;
  origin: Origin;
  operation: Operation;
}

function exceptionsOf(operation: Operation): Exception[] {
  const found: Exception[] = [];
  const add = (written: string, origin: Origin) => {
    if (lintOwnsOrigin(origin) && origin.pointer.startsWith(TREE_PREFIX))
      found.push({ written, origin, operation });
  };

  const { access, csrf, idempotency, unknownQuery } = operation;

  if (isKnownVariant("Access", access) && access.kind === "public")
    add("access.public", access.origin);

  if (isKnownVariant("Access", access) && access.kind === "optional")
    add("access.optionalAuth", access.origin);

  if (csrf !== undefined && isKnownVariant("Csrf", csrf) && csrf.kind === "exempt")
    add("csrf.exempt", csrf.origin);

  if (
    idempotency !== undefined &&
    isKnownVariant("Idempotency", idempotency) &&
    idempotency.kind === "exempt"
  )
    add("idempotency.exempt", idempotency.origin);

  if (isKnownVariant("UnknownQuery", unknownQuery) && unknownQuery.policy === "ignore")
    add("unknownQuery: { ignore }", unknownQuery.origin);

  return found;
}

export const subtreeException: LintRuleDefinition = {
  name: "subtree-exception",
  defaultSeverity: "warning",
  reports: "a safety exception written above a route or surface root (section 8)",
  silencedOn: "the node",
  check({ ir, report }) {
    const routes = new Set(ir.operations.map((operation) => lintOriginKey(operation.origin)));
    const misplaced = ir.operations.flatMap(exceptionsOf).filter(({ origin }) => {
      const node = lintNodeOf(origin);

      return !routes.has(lintOriginKey(node)) && !SURFACE_ROOT.test(node.pointer);
    });

    for (const { origin, entries } of lintGroupByOrigin(misplaced)) {
      const node = lintNodeOf(origin);
      const form = entries[0]?.written;
      const reached = lintRoutesNamed(entries.map((entry) => entry.operation));

      report({
        message: `The exception ${form} is written on '${node.pointer}', which is neither a route nor a surface root, so it reaches ${reached}.`,
        fix: "Move the exception to the route or the surface root it is meant for, or allow seampact/subtree-exception on that node with a reason.",
        origin,
        allowAt: [node],
      });
    }
  },
};
