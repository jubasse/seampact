import type { IrWriter } from "@seampact/spec/ir";
import {
  type InheritedEntry,
  pipelineCopy,
  pipelinePointerBelow,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";

import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsContext } from "./schema-use.js";
import { accessRightsValueSource } from "./source.js";

// The scopes of an operation (FR-24, A23, ADR 0002 section 9), in resolution order: a scope entered at an ancestor
// before one entered below it; inside one node, a parent scope before its child, then by name. A scope entered
// twice, or below one of its own child scopes, is an error naming both places; so is one whose parent is not entered.

interface ScopeUse {
  readonly scope: string;
  readonly entry: InheritedEntry;
  readonly pointer: string;
}

/** The resolved scopes of the route at `node`, each with its source and the origin of the node that entered it. */
export function accessRightsOperationScopes(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  node: TreeNode,
): IrWriter.OperationScope[] {
  const resolved: ScopeUse[] = [];
  const groups = usesByNode(context, reporter, catalogues, node);
  const enteredNames = new Set(groups.flat().map((use) => use.scope));

  for (const group of groups)
    for (const use of resolutionOrder(group, catalogues)) {
      if (checkEnteredOnce(reporter, catalogues, resolved, enteredNames, use)) resolved.push(use);
    }

  return resolved.map((use) => {
    const text = use.entry.value;
    const source = typeof text === "string" ? accessRightsValueSource(text) : undefined;

    if (source === undefined)
      throw new Error(
        `the scope source ${JSON.stringify(text)} at ${use.pointer} is outside the grammar's forms`,
      );

    return { scope: use.scope, source, origin: pipelineCopy(use.entry.origin) };
  });
}

// The scope entries from the root down, grouped by the node that wrote them; an undeclared scope is reported, a
// declared one that was refused is left out silently (its declaration already has an error).
function usesByNode(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  node: TreeNode,
): ScopeUse[][] {
  const groups: ScopeUse[][] = [];
  let current: TreeNode | undefined;

  for (const entry of context.inherited(node, "scopes")?.entries ?? []) {
    const scope = entry.key;

    if (scope === undefined)
      throw new Error(`a 'scopes' entry of ${entry.node.pointer} is read without its scope name`);
    const pointer = pipelinePointerBelow(entry.node.pointer, "scopes", scope);

    if (!catalogues.declared.scopes.has(scope)) {
      reporter.error({
        rule: "scope-unknown",
        message: `scope '${scope}' is entered here, but the scopes catalogue does not declare it`,
        fix: "declare the scope in 'scopes', or enter a declared one",
        pointer,
      });
      continue;
    }

    if (!catalogues.scopes.has(scope)) continue;

    if (entry.node !== current) {
      groups.push([]);
      current = entry.node;
    }

    groups[groups.length - 1]?.push({ scope, entry, pointer });
  }

  return groups;
}

/** The scopes `scope` is within, nearest first. The catalogue refused every cycle, so the chain ends. */
export function accessRightsScopeAncestors(
  catalogues: AccessRightsCatalogues,
  scope: string,
): string[] {
  const ancestors: string[] = [];

  for (
    let parent = catalogues.scopes.get(scope)?.within;
    parent !== undefined;
    parent = catalogues.scopes.get(parent)?.within
  )
    ancestors.push(parent);

  return ancestors;
}

// One node's scopes: each after the ones it is within, then by name.
function resolutionOrder(group: ScopeUse[], catalogues: AccessRightsCatalogues): ScopeUse[] {
  const remaining = [...group].sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  const ordered: ScopeUse[] = [];

  while (remaining.length > 0) {
    const names = new Set(remaining.map((use) => use.scope));
    const index = remaining.findIndex((use) =>
      accessRightsScopeAncestors(catalogues, use.scope).every((parent) => !names.has(parent)),
    );
    const [next] = remaining.splice(index < 0 ? 0 : index, 1);

    if (next !== undefined) ordered.push(next);
  }

  return ordered;
}

// A scope entered twice, below one of its own child scopes, or without its parent entered is an error; true when `use` may be resolved.
function checkEnteredOnce(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  resolved: readonly ScopeUse[],
  enteredNames: ReadonlySet<string>,
  use: ScopeUse,
): boolean {
  const twice = resolved.find((earlier) => earlier.scope === use.scope);

  if (twice !== undefined) {
    reporter.error({
      rule: "scope-twice",
      message: `scope '${use.scope}' is entered twice on the routes below this node`,
      fix: "enter the scope once, on the highest node that needs it",
      pointer: use.pointer,
      related: [{ pointer: twice.pointer, message: "first entered here" }],
    });

    return false;
  }

  const child = resolved.find((earlier) =>
    accessRightsScopeAncestors(catalogues, earlier.scope).includes(use.scope),
  );

  if (child !== undefined) {
    reporter.error({
      rule: "scope-nesting",
      message: `scope '${use.scope}' is entered below '${child.scope}', which is within it`,
      fix: `enter '${use.scope}' on '${child.scope}''s node or above it`,
      pointer: use.pointer,
      related: [{ pointer: child.pointer, message: `'${child.scope}' is entered here` }],
    });

    return false;
  }

  const parent = catalogues.scopes.get(use.scope)?.within;

  // A parent entered below this scope is reported at its own entry as a scope entered below its child.
  if (parent !== undefined && !enteredNames.has(parent)) {
    reporter.error({
      rule: "scope-nesting",
      message: `scope '${use.scope}' is within '${parent}', which is not entered at this node or an ancestor`,
      fix: `enter '${parent}' at this node or an ancestor`,
      pointer: use.pointer,
    });

    return false;
  }

  return true;
}
