import type { ContractIR } from "@seampact/spec/ir";
import { DIFF_CODES } from "../diff-codes.js";
import type { DiffRefusal } from "../result.js";
import type { DiffKind } from "../table/rows.js";
import { memberRow } from "../table/member-rows.js";
import { isSameJson, pointerJoin, scalarValue } from "./json.js";
import type { ReachIndex } from "./reach.js";
import type { ChangeReach, ChangeSink, ElementOrigin, RawChange } from "./sink.js";

// What every comparison of the walk shares: the two IRs, their reach indexes and the sink, and the generic
// member comparison driven by the member table.

export interface WalkContext {
  readonly before: ContractIR;
  readonly after: ContractIR;
  readonly beforeReach: ReachIndex;
  readonly afterReach: ReachIndex;
  readonly sink: ChangeSink;
}

/** Where the changes of one element go: its reaches, and its origin for the pack cause. */
export interface ChangeSite {
  readonly reaches: readonly ChangeReach[];
  readonly origin?: ElementOrigin | undefined;
}

export type MemberComparison = (pointer: string, before: unknown, after: unknown) => void;

type MemberComparisons = Readonly<Partial<Record<string, MemberComparison>>>;

const INFORMATIVE_MEMBER_ROWS: ReadonlySet<DiffKind> = new Set(["name", "annotation"]);

export function emitAt(
  context: WalkContext,
  site: ChangeSite,
  change: Omit<RawChange, "origin">,
): void {
  context.sink.emit({ ...change, origin: site.origin }, site.reaches);
}

/**
 * Compares the members of two values of `definition`. A member equal in both is skipped; one with a comparison
 * runs it; any other reports its row when that row is `name` or `annotation`, else `unclassified` naming the
 * member, so no difference goes unreported.
 */
export function compareMembers(
  context: WalkContext,
  site: ChangeSite,
  definition: string,
  pointer: string,
  before: object | undefined,
  after: object | undefined,
  comparisons: MemberComparisons,
): void {
  const beforeMembers: Record<string, unknown> = { ...before };
  const afterMembers: Record<string, unknown> = { ...after };
  const names = new Set([...Object.keys(beforeMembers), ...Object.keys(afterMembers)]);

  for (const member of [...names].sort()) {
    const beforeValue = beforeMembers[member];
    const afterValue = afterMembers[member];

    if (isSameJson(beforeValue, afterValue)) continue;

    const memberPointer = pointerJoin(pointer, member);
    const comparison = comparisons[member];

    if (comparison !== undefined) {
      comparison(memberPointer, beforeValue, afterValue);
      continue;
    }

    const row = memberRow(definition, member);
    const informative = INFORMATIVE_MEMBER_ROWS.has(row);

    emitAt(context, site, {
      kind: informative ? row : "unclassified",
      case: informative ? member : `${definition}.${member}`,
      pointer: memberPointer,
      before: beforeValue,
      after: afterValue,
    });
  }
}

/** Refuses the diff on an open enum value the walk must act on, naming the value, the member and the operations. */
export function refuseUnknownValue(
  context: WalkContext,
  site: ChangeSite,
  member: string,
  value: unknown,
): void {
  const operations = [...new Set(site.reaches.flatMap((reach) => reach.operations))].sort();

  context.sink.refuse(unknownValueRefusal(member, value, operations));
}

export function unknownValueRefusal(
  member: string,
  value: unknown,
  operations: readonly string[],
): DiffRefusal {
  const where = operations.length > 0 ? ` on ${operations.join(", ")}` : "";

  return {
    code: DIFF_CODES.unknownValue,
    message: `${member} holds ${JSON.stringify(scalarValue(value) ?? value)}${where}, a value this diff does not know.`,
    fix: "Run a @seampact/diff that reads this IR revision.",
    member,
    operations: [...operations],
  };
}

/** The reaches moved to position `none`, their operations kept: for rows that hold no position. */
export function withoutPosition(reaches: readonly ChangeReach[]): readonly ChangeReach[] {
  if (reaches.length === 0) return [];

  const operations = [...new Set(reaches.flatMap((reach) => reach.operations))];

  return [{ position: "none", operations }];
}

/** An `order` change when the names both lists keep are in another order. */
export function compareKeptOrder(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  orderCase: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const keptBefore = before.filter((name) => after.includes(name));
  const keptAfter = after.filter((name) => before.includes(name));

  if (keptBefore.join("\u0000") === keptAfter.join("\u0000")) return;

  emitAt(context, site, { kind: "order", case: orderCase, pointer });
}
