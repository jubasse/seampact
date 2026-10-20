import {
  type Access,
  type Binding,
  type Csrf,
  type FieldRight,
  isKnownVariant,
  type KnownAccess,
  type Operation,
  type OperationScope,
  type PrincipalRequirement,
  type Requirement,
} from "@seampact/spec/ir";
import {
  type ChangeSite,
  compareKeptOrder,
  compareKeyedList,
  compareMembers,
  emitAt,
  type MemberComparison,
  refuseUnknownValue,
  type WalkContext,
} from "./context.js";
import { pointerJoin } from "./json.js";

// What admits a request to an operation, at the input position: the unknown query policy, the access, the caller
// kinds, the principal requirements, scopes, rights and rules, bindings, field rights, the list filter, CSRF and
// the owner. Adding a requirement refuses requests `before` clients send; removing one lets handlers receive
// requests they were written to never see.

type MemberComparisons = Readonly<Record<string, MemberComparison>>;

const UNKNOWN_QUERY_CASES: Readonly<Record<string, string>> = {
  refuse: "refused",
  ignore: "ignored",
};

const ACCESS_DEFINITIONS = {
  identity: "IdentityAccess",
  optional: "OptionalAccess",
  public: "PublicAccess",
} as const;

// The more callers an access admits, the lower its rank.
const PUBLIC_RANK = 0;
const OPTIONAL_ANONYMOUS_RANK = 1;
const OPTIONAL_REJECT_RANK = 2;
const IDENTITY_RANK = 3;

const FIELD_RIGHT_POSITIONS = ["input", "output"] as const;

export function accessComparisons(
  context: WalkContext,
  before: Operation,
  after: Operation,
): MemberComparisons {
  const input: ChangeSite = {
    reaches: [{ position: "input", operations: [after.id] }],
    origin: after.origin,
  };
  const output: ChangeSite = {
    ...input,
    reaches: [{ position: "output", operations: [after.id] }],
  };

  return {
    unknownQuery: (pointer) => compareUnknownQuery(context, input, pointer, before, after),
    access: (pointer) => compareAccess(context, input, pointer, before.access, after.access),
    callerKinds: (pointer) => compareCallerKinds(context, input, pointer, before, after),
    principalRequires: (pointer) =>
      comparePrincipalRequirements(
        context,
        input,
        pointer,
        before.principalRequires,
        after.principalRequires,
      ),
    scopes: (pointer) => compareScopes(context, input, pointer, before.scopes, after.scopes),
    requires: (pointer) =>
      compareRequirements(context, input, pointer, before.requires, after.requires),
    bindings: (pointer) =>
      compareBindings(context, input, pointer, before.bindings, after.bindings),
    fieldRights: (pointer) =>
      compareFieldRights(context, input, pointer, before.fieldRights, after.fieldRights),
    filteredBy: (pointer) =>
      emitPresence(context, output, "filteredBy", pointer, before.filteredBy, after.filteredBy),
    csrf: (pointer) => compareCsrf(context, input, pointer, before.csrf, after.csrf),
    owner: (pointer) => {
      if (before.owner === undefined || after.owner === undefined) {
        emitPresence(context, input, "owner", pointer, before.owner?.kind, after.owner?.kind);

        return;
      }

      compareMembers(context, input, "Owner", pointer, before.owner, after.owner, {});
    },
  };
}

/** An optional member added, removed or changed: the `added`, `removed` or `changed` case of `kind`. */
export function emitPresence(
  context: WalkContext,
  site: ChangeSite,
  kind: "filteredBy" | "owner" | "concurrency",
  pointer: string,
  before: unknown,
  after: unknown,
): void {
  const presenceCase = before === undefined ? "added" : after === undefined ? "removed" : "changed";

  emitAt(context, site, { kind, case: presenceCase, pointer, before, after });
}

function compareUnknownQuery(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Operation,
  after: Operation,
): void {
  const beforePolicy = before.unknownQuery.policy;
  const afterPolicy = after.unknownQuery.policy;
  const policyCase = UNKNOWN_QUERY_CASES[afterPolicy];

  if (policyCase === undefined || UNKNOWN_QUERY_CASES[beforePolicy] === undefined) {
    const unknown = policyCase === undefined ? afterPolicy : beforePolicy;

    refuseUnknownValue(context, site, pointerJoin(pointer, "policy"), unknown);

    return;
  }

  if (beforePolicy !== afterPolicy) {
    emitAt(context, site, {
      kind: "unknownQuery",
      case: policyCase,
      pointer,
      before: beforePolicy,
      after: afterPolicy,
    });

    return;
  }

  const definition = afterPolicy === "refuse" ? "RefuseUnknownQuery" : "IgnoreUnknownQuery";

  compareMembers(context, site, definition, pointer, before.unknownQuery, after.unknownQuery, {});
}

function compareAccess(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Access,
  after: Access,
): void {
  for (const access of [before, after]) {
    if (!isKnownVariant("Access", access)) {
      refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), access.kind);

      return;
    }
  }

  if (!isKnownVariant("Access", before) || !isKnownVariant("Access", after)) return;

  const beforeRank = accessRank(context, site, pointer, before);
  const afterRank = accessRank(context, site, pointer, after);

  if (beforeRank === undefined || afterRank === undefined) return;

  if (beforeRank !== afterRank) {
    emitAt(context, site, {
      kind: "access",
      case: afterRank > beforeRank ? "tightened" : "loosened",
      pointer,
      before: before.kind,
      after: after.kind,
    });
  }

  const ranked = () => undefined;
  const credentials =
    before.kind !== "public" && after.kind !== "public" ? { before, after } : undefined;

  compareMembers(context, site, ACCESS_DEFINITIONS[after.kind], pointer, before, after, {
    kind: ranked,
    onRefused: ranked,
    // Read here, as the after kind may not hold it.
    reason: (memberPointer, beforeValue, afterValue) =>
      emitAt(context, site, {
        kind: "annotation",
        case: "reason",
        pointer: memberPointer,
        before: beforeValue,
        after: afterValue,
      }),
    // A public access holds neither: the rank change says it all.
    identity: (memberPointer, beforeValue, afterValue) => {
      if (credentials === undefined) return;

      emitAt(context, site, {
        kind: "access",
        case: "identity",
        pointer: memberPointer,
        before: beforeValue,
        after: afterValue,
      });
    },
    schemes: (memberPointer) => {
      if (credentials === undefined) return;

      compareNames(context, site, memberPointer, "access", "schemeAdded", "schemeRemoved", {
        before: credentials.before.schemes,
        after: credentials.after.schemes,
      });
    },
  });
}

function accessRank(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  access: KnownAccess,
): number | undefined {
  switch (access.kind) {
    case "public":
      return PUBLIC_RANK;
    case "identity":
      return IDENTITY_RANK;
    case "optional":
      if (access.onRefused === "anonymous") return OPTIONAL_ANONYMOUS_RANK;

      if (access.onRefused === "reject") return OPTIONAL_REJECT_RANK;

      refuseUnknownValue(context, site, pointerJoin(pointer, "onRefused"), access.onRefused);

      return undefined;
  }
}

function compareCallerKinds(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Operation,
  after: Operation,
): void {
  compareNames(context, site, pointer, "callerKind", "added", "removed", {
    before: before.callerKinds,
    after: after.callerKinds,
  });
}

// Names added to or removed from a list, each one change; a reorder alone is `order`.
function compareNames(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  kind: "access" | "callerKind",
  addedCase: string,
  removedCase: string,
  names: { before: readonly string[]; after: readonly string[] },
): void {
  for (const name of names.after.filter((candidate) => !names.before.includes(candidate)))
    emitAt(context, site, { kind, case: addedCase, pointer, after: name });

  for (const name of names.before.filter((candidate) => !names.after.includes(candidate)))
    emitAt(context, site, { kind, case: removedCase, pointer, before: name });

  compareKeptOrder(context, site, pointer, "values", names.before, names.after);
}

function comparePrincipalRequirements(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly PrincipalRequirement[],
  after: readonly PrincipalRequirement[],
): void {
  compareKeyedList(pointer, before, after, {
    keyOf: (requirement) => requirement.field,
    added: (entryPointer, requirement) =>
      emitAt(context, site, {
        kind: "principalRequirement",
        case: "added",
        pointer: entryPointer,
        after: requirement.field,
      }),
    removed: (entryPointer, requirement) =>
      emitAt(context, site, {
        kind: "principalRequirement",
        case: "removed",
        pointer: entryPointer,
        before: requirement.field,
      }),
    kept: (entryPointer, beforeEntry, afterEntry) =>
      compareMembers(
        context,
        site,
        "PrincipalRequirement",
        entryPointer,
        beforeEntry,
        afterEntry,
        {},
      ),
  });
}

function compareScopes(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly OperationScope[],
  after: readonly OperationScope[],
): void {
  const scopeOf = (scope: OperationScope) => scope.scope;

  compareKeyedList(pointer, before, after, {
    keyOf: scopeOf,
    added: (entryPointer, scope) =>
      emitAt(context, site, {
        kind: "scope",
        case: "added",
        pointer: entryPointer,
        after: scope.scope,
      }),
    removed: (entryPointer, scope) =>
      emitAt(context, site, {
        kind: "scope",
        case: "removed",
        pointer: entryPointer,
        before: scope.scope,
      }),
    kept: (entryPointer, beforeEntry, afterEntry) =>
      compareMembers(context, site, "OperationScope", entryPointer, beforeEntry, afterEntry, {}),
  });

  compareKeptOrder(context, site, pointer, "scopes", before.map(scopeOf), after.map(scopeOf));
}

// A requirement is matched by its right or rule and its rank among the requirements naming the same one.
function requirementKey(
  requirement: Requirement,
  index: number,
  list: readonly Requirement[],
): string {
  const name = requirementName(requirement);
  const rank = list
    .slice(0, index)
    .filter((candidate) => requirementName(candidate) === name).length;

  return `${name}\u0000${rank}`;
}

function requirementName(requirement: Requirement): string {
  if (!isKnownVariant("Requirement", requirement)) return `${requirement.kind}`;

  return requirement.kind === "right"
    ? `right\u0000${requirement.right}`
    : `rule\u0000${requirement.rule}`;
}

function compareRequirements(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly Requirement[],
  after: readonly Requirement[],
): void {
  for (const requirement of [...before, ...after]) {
    if (!isKnownVariant("Requirement", requirement)) {
      refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), requirement.kind);

      return;
    }
  }

  const label = (requirement: Requirement) => requirementName(requirement).replace("\u0000", " ");

  compareKeyedList(pointer, before, after, {
    keyOf: requirementKey,
    added: (entryPointer, requirement) =>
      emitAt(context, site, {
        kind: "requirement",
        case: "added",
        pointer: entryPointer,
        after: label(requirement),
      }),
    removed: (entryPointer, requirement) =>
      emitAt(context, site, {
        kind: "requirement",
        case: "removed",
        pointer: entryPointer,
        before: label(requirement),
      }),
    kept: (entryPointer, beforeEntry, afterEntry) =>
      compareMembers(
        context,
        site,
        afterEntry.kind === "rule" ? "RuleRequirement" : "RightRequirement",
        entryPointer,
        beforeEntry,
        afterEntry,
        {},
      ),
  });

  const keysOf = (list: readonly Requirement[]) => list.map(requirementKey);

  compareKeptOrder(context, site, pointer, "requires", keysOf(before), keysOf(after));
}

function compareBindings(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly Binding[],
  after: readonly Binding[],
): void {
  const targetOf = (binding: Binding) => JSON.stringify(binding.to);

  compareKeyedList(pointer, before, after, {
    keyOf: targetOf,
    added: (entryPointer) =>
      emitAt(context, site, { kind: "binding", case: "added", pointer: entryPointer }),
    removed: (entryPointer) =>
      emitAt(context, site, { kind: "binding", case: "removed", pointer: entryPointer }),
    kept: (entryPointer, beforeEntry, afterEntry) =>
      compareMembers(context, site, "Binding", entryPointer, beforeEntry, afterEntry, {
        from: (memberPointer) =>
          emitAt(context, site, { kind: "binding", case: "changed", pointer: memberPointer }),
      }),
  });
}

// A field right is classified at its own direction.
function compareFieldRights(
  context: WalkContext,
  input: ChangeSite,
  pointer: string,
  before: readonly FieldRight[],
  after: readonly FieldRight[],
): void {
  const siteOf = (fieldRight: FieldRight): ChangeSite | undefined => {
    const position = FIELD_RIGHT_POSITIONS.find((candidate) => candidate === fieldRight.direction);

    if (position === undefined) {
      refuseUnknownValue(context, input, pointerJoin(pointer, "direction"), fieldRight.direction);

      return undefined;
    }

    const operations = input.reaches.flatMap((reach) => reach.operations);

    return { ...input, reaches: [{ position, operations }] };
  };

  const emitFieldRight = (fieldRightCase: string, entryPointer: string, fieldRight: FieldRight) => {
    const site = siteOf(fieldRight);

    if (site !== undefined)
      emitAt(context, site, {
        kind: "fieldRight",
        case: fieldRightCase,
        pointer: entryPointer,
        after: fieldRight.right,
      });
  };

  compareKeyedList(pointer, before, after, {
    keyOf: (fieldRight) =>
      `${fieldRight.direction}\u0000${fieldRight.schema}\u0000${fieldRight.pointer}`,
    added: (entryPointer, fieldRight) => emitFieldRight("added", entryPointer, fieldRight),
    removed: (entryPointer, fieldRight) => emitFieldRight("removed", entryPointer, fieldRight),
    kept: (entryPointer, beforeEntry, afterEntry) => {
      const site = siteOf(afterEntry);

      if (site === undefined) return;

      compareMembers(context, site, "FieldRight", entryPointer, beforeEntry, afterEntry, {
        right: () => emitFieldRight("changed", entryPointer, afterEntry),
      });
    },
  });
}

// CSRF protection is on when derived; absent and exempt both leave it off.
function compareCsrf(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Csrf | undefined,
  after: Csrf | undefined,
): void {
  for (const csrf of [before, after]) {
    if (csrf !== undefined && !isKnownVariant("Csrf", csrf)) {
      refuseUnknownValue(context, site, pointerJoin(pointer, "kind"), csrf.kind);

      return;
    }
  }

  const beforeOn = before?.kind === "derived";
  const afterOn = after?.kind === "derived";

  if (beforeOn !== afterOn) {
    emitAt(context, site, {
      kind: "csrf",
      case: afterOn ? "added" : "removed",
      pointer,
      before: before?.kind,
      after: after?.kind,
    });

    return;
  }

  if (before === undefined || after === undefined || before.kind !== after.kind) {
    emitAt(context, site, {
      kind: "annotation",
      case: "csrf",
      pointer,
      before: before?.kind,
      after: after?.kind,
    });

    return;
  }

  compareMembers(context, site, afterOn ? "DerivedCsrf" : "ExemptCsrf", pointer, before, after, {});
}
