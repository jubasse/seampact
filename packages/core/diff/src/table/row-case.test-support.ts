import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DiffPosition } from "../result.js";
import { changesOf, editedIr, goldenIr } from "../test-support.js";
import type { DiffKind } from "./rows.js";

// One case per row, case and position of the classification table (CHK-175, CHK-176), each a golden IR pair
// built by editing the reference IR, run by every table test file.

export type Edit = (ir: ContractIR) => void;

type Expected = "C" | "S" | "CS" | "-" | "info";

export interface RowCase {
  kind: DiffKind;
  case: string;
  position: DiffPosition;
  expected: Expected;
  note?: string;
  /** Picks the change whose pointer holds this fragment, when the same row is also reported elsewhere. */
  pointerFragment?: string;
  base?: Edit;
  after: Edit;
}

const EXPECTED_OUTCOMES: Record<Expected, { breaks: string[]; classification: string }> = {
  C: { breaks: ["clients"], classification: "breaking" },
  S: { breaks: ["servers"], classification: "breaking" },
  CS: { breaks: ["clients", "servers"], classification: "breaking" },
  "-": { breaks: [], classification: "additive" },
  info: { breaks: [], classification: "informative" },
};

/** Each case as a test named `classifies <kind> <case> at <position><note>`, with no other change unclassified. */
export function testRowCases(title: string, rowCases: readonly RowCase[]): void {
  describe(title, () => {
    test.each(
      rowCases.map((rowCase) => ({
        ...rowCase,
        name: `${rowCase.kind} ${rowCase.case} at ${rowCase.position}${rowCase.note ?? ""}`,
      })),
    )("classifies $name", (rowCase) => {
      const base = rowCase.base === undefined ? goldenIr() : editedIr(rowCase.base);
      const after = editedIr(rowCase.after, base);
      const changes = changesOf(base, after);
      const change = changes.find(
        (candidate) =>
          candidate.kind === rowCase.kind &&
          candidate.case === rowCase.case &&
          candidate.position === rowCase.position &&
          candidate.pointer.includes(rowCase.pointerFragment ?? ""),
      );
      const unclassified = changes.filter(
        (candidate) => candidate.kind === "unclassified" && rowCase.kind !== "unclassified",
      );

      expect(change, `no ${rowCase.kind} ${rowCase.case} at ${rowCase.position}`).toBeDefined();
      expect(unclassified).toEqual([]);
      expect({ breaks: change?.breaks, classification: change?.classification }).toEqual(
        EXPECTED_OUTCOMES[rowCase.expected],
      );
    });
  });
}
