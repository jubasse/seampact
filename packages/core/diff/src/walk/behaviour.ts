import {
  type DerivedIdempotency,
  type Idempotency,
  isKnownVariant,
  type Operation,
  type OperationError,
  type Paging,
  type SortKey,
} from "@seampact/spec/ir";
import { emitPresence } from "./access.js";
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
import { compareBound } from "./type-use.js";

// What an operation promises beyond its params and bodies: the error codes it answers (output), idempotency,
// optimistic concurrency and paging (input).

type MemberComparisons = Readonly<Record<string, MemberComparison>>;

const ENFORCE_CASES: Readonly<Record<string, string>> = {
  boundary: "enforceAdded",
  none: "enforceDropped",
};

const OVER_LIMIT_CASES: Readonly<Record<string, string>> = {
  reject: "overLimitRejected",
  clamp: "overLimitClamped",
};

function lifetimeCase(before: DerivedIdempotency, after: DerivedIdempotency): string {
  if (after.lifetimeMs < before.lifetimeMs) return "lifetimeShortened";

  return after.enforce === "boundary" ? "lifetimeLengthened" : "lifetimeLengthenedUnenforced";
}

export function behaviourComparisons(
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
    errors: (pointer) => compareErrors(context, output, pointer, before.errors, after.errors),
    idempotency: (pointer) =>
      compareIdempotency(
        context,
        { input, output },
        pointer,
        before.idempotency,
        after.idempotency,
      ),
    concurrency: (pointer) => {
      if (before.concurrency === undefined || after.concurrency === undefined) {
        emitPresence(
          context,
          input,
          "concurrency",
          pointer,
          before.concurrency?.field,
          after.concurrency?.field,
        );

        return;
      }

      compareMembers(
        context,
        input,
        "Concurrency",
        pointer,
        before.concurrency,
        after.concurrency,
        {},
      );
    },
    paging: (pointer) => comparePaging(context, input, pointer, before.paging, after.paging),
  };
}

function compareErrors(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly OperationError[],
  after: readonly OperationError[],
): void {
  compareKeyedList(pointer, before, after, {
    keyOf: (error) => error.code,
    added: (entryPointer, error) =>
      emitAt(context, site, {
        kind: "error",
        case: "added",
        pointer: entryPointer,
        after: error.code,
      }),
    removed: (entryPointer, error) =>
      emitAt(context, site, {
        kind: "error",
        case: "removed",
        pointer: entryPointer,
        before: error.code,
      }),
    kept: (entryPointer, beforeError, afterError) =>
      compareMembers(context, site, "OperationError", entryPointer, beforeError, afterError, {
        retryHeader: (memberPointer) => {
          if (beforeError.retryHeader === undefined || afterError.retryHeader === undefined) {
            emitAt(context, site, {
              kind: "error",
              case:
                beforeError.retryHeader === undefined ? "retryHeaderAdded" : "retryHeaderRemoved",
              pointer: memberPointer,
              before: beforeError.retryHeader?.name,
              after: afterError.retryHeader?.name,
            });

            return;
          }

          compareMembers(
            context,
            site,
            "RetryHeader",
            memberPointer,
            beforeError.retryHeader,
            afterError.retryHeader,
            {},
          );
        },
      }),
  });
}

// Idempotency is on when derived; absent and exempt both leave it off.
function compareIdempotency(
  context: WalkContext,
  sites: { input: ChangeSite; output: ChangeSite },
  pointer: string,
  before: Idempotency | undefined,
  after: Idempotency | undefined,
): void {
  const { input, output } = sites;

  for (const idempotency of [before, after]) {
    if (idempotency !== undefined && !isKnownVariant("Idempotency", idempotency)) {
      refuseUnknownValue(context, input, pointerJoin(pointer, "kind"), idempotency.kind);

      return;
    }
  }

  const beforeOn = derivedOf(before);
  const afterOn = derivedOf(after);

  if (beforeOn !== undefined && afterOn !== undefined) {
    compareMembers(context, input, "DerivedIdempotency", pointer, beforeOn, afterOn, {
      required: (memberPointer) =>
        emitAt(context, input, {
          kind: "idempotency",
          case: afterOn.required ? "optionalToRequired" : "requiredToOptional",
          pointer: memberPointer,
          before: beforeOn.required,
          after: afterOn.required,
        }),
      // A shorter lifetime lets a replay reach the handler sooner; a longer one, under a boundary, replays or
      // refuses a key that `before` clients reused once it expired.
      lifetimeMs: (memberPointer) =>
        emitAt(context, input, {
          kind: "idempotency",
          case: lifetimeCase(beforeOn, afterOn),
          pointer: memberPointer,
          before: beforeOn.lifetimeMs,
          after: afterOn.lifetimeMs,
        }),
      enforce: (memberPointer) => {
        const enforceCase = ENFORCE_CASES[afterOn.enforce];

        if (enforceCase === undefined) {
          refuseUnknownValue(context, input, memberPointer, afterOn.enforce);

          return;
        }

        emitAt(context, input, {
          kind: "idempotency",
          case: enforceCase,
          pointer: memberPointer,
          before: beforeOn.enforce,
          after: afterOn.enforce,
        });
      },
      replayHeader: (memberPointer) =>
        emitAt(context, output, {
          kind: "idempotency",
          case: "replayHeader",
          pointer: memberPointer,
          before: beforeOn.replayHeader,
          after: afterOn.replayHeader,
        }),
    });

    return;
  }

  if (afterOn !== undefined) {
    emitAt(context, input, {
      kind: "idempotency",
      case: afterOn.required ? "addedRequired" : "addedOptional",
      pointer,
      before: before?.kind,
      after: afterOn.kind,
    });

    return;
  }

  if (beforeOn !== undefined) {
    emitAt(context, input, {
      kind: "idempotency",
      case: "removed",
      pointer,
      before: beforeOn.kind,
      after: after?.kind,
    });

    return;
  }

  // Off on both sides: an exemption added, removed or reworded.
  emitAt(context, input, {
    kind: "annotation",
    case: "idempotency",
    pointer,
    before: before?.kind,
    after: after?.kind,
  });
}

function derivedOf(idempotency: Idempotency | undefined): DerivedIdempotency | undefined {
  if (idempotency === undefined || !isKnownVariant("Idempotency", idempotency)) return undefined;

  return idempotency.kind === "derived" ? idempotency : undefined;
}

function comparePaging(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Paging | undefined,
  after: Paging | undefined,
): void {
  if (before === undefined || after === undefined) {
    emitAt(context, site, {
      kind: "paging",
      case: before === undefined ? "added" : "removed",
      pointer,
      before: before?.style,
      after: after?.style,
    });

    return;
  }

  compareMembers(context, site, "Paging", pointer, before, after, {
    maxLimit: (memberPointer) =>
      compareBound(context, site, memberPointer, "upper", before.maxLimit, after.maxLimit),
    overLimit: (memberPointer) => {
      const overLimitCase = OVER_LIMIT_CASES[after.overLimit];

      if (overLimitCase === undefined) {
        refuseUnknownValue(context, site, memberPointer, after.overLimit);

        return;
      }

      emitAt(context, site, {
        kind: "paging",
        case: overLimitCase,
        pointer: memberPointer,
        before: before.overLimit,
        after: after.overLimit,
      });
    },
    sortKeys: (memberPointer) =>
      compareSortKeys(context, site, memberPointer, before.sortKeys, after.sortKeys),
  });
}

function compareSortKeys(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly SortKey[],
  after: readonly SortKey[],
): void {
  compareKeyedList(pointer, before, after, {
    keyOf: (sortKey) => sortKey.key,
    added: (entryPointer, sortKey) =>
      emitAt(context, site, {
        kind: "paging",
        case: "sortKeyAdded",
        pointer: entryPointer,
        after: sortKey.key,
      }),
    removed: (entryPointer, sortKey) =>
      emitAt(context, site, {
        kind: "paging",
        case: "sortKeyRemoved",
        pointer: entryPointer,
        before: sortKey.key,
      }),
    kept: (entryPointer, beforeKey, afterKey) =>
      compareMembers(context, site, "SortKey", entryPointer, beforeKey, afterKey, {}),
  });

  const keyOf = (sortKey: SortKey) => sortKey.key;

  compareKeptOrder(context, site, pointer, "values", before.map(keyOf), after.map(keyOf));
}
