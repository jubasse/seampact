import { describe, expect, it } from "vitest";
import { BRIEF_LINES, cutBriefs, type FunctionUnit } from "./pass-coverage.ts";

function unit(id: number, lines: number): FunctionUnit {
  return {
    id,
    file: "a.ts",
    name: `f${id}`,
    startLine: id * 1000,
    endLine: id * 1000 + lines - 1,
    lines,
  };
}

describe("cutBriefs", () => {
  it("puts the spine in brief 1, then reached functions by gain, never-reached ones last", () => {
    const units = [unit(0, 50), unit(1, 400), unit(2, 30), unit(3, 900)];
    const pairs = [new Set([0, 2]), new Set([0, 1]), new Set([0])];
    const coverage = cutBriefs(units, pairs);

    expect(coverage.rows.map((row) => [row.unit.name, row.brief])).toEqual([
      ["f0", 1],
      ["f2", 1],
      ["f1", 1],
      ["f3", 2],
    ]);
    expect(coverage.spineLines).toBe(50);
    expect(coverage.comparableAfterBrief).toEqual([3, 3]);
  });

  it("opens a new brief past the line budget but keeps a long spine whole", () => {
    const units = [unit(0, BRIEF_LINES + 200), unit(1, 10)];
    const pairs = [new Set([0]), new Set([0, 1])];
    const coverage = cutBriefs(units, pairs);

    expect(coverage.rows.map((row) => row.brief)).toEqual([1, 2]);
    expect(coverage.comparableAfterBrief).toEqual([1, 2]);
  });

  it("orders a function another half calls right after the spine", () => {
    const units = [unit(0, 10), unit(1, 10), unit(2, 10)];
    const pairs = [new Set([0, 1]), new Set([0, 1]), new Set([0])];
    const coverage = cutBriefs(units, pairs, new Set([2]));

    expect(coverage.rows.map((row) => row.unit.name)).toEqual(["f0", "f2", "f1"]);
  });
});
