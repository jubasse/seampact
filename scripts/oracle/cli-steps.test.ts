import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyTreeStep, cliStepsProblems } from "./cli-steps.ts";
import { cliSpecProblems } from "./tool-cli.ts";

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "seampact-oracle-steps-"));

  roots.push(root);

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the steps form of cli.json", () => {
  test("a case of commands and tree edits is valid", () => {
    const spec = {
      steps: [{ argv: ["generate"] }, { write: { "a/b.txt": "x" } }, { remove: ["a"] }],
      env: { SEAMPACT_ALLOW_LOCAL: "1" },
    };

    expect(cliSpecProblems(spec)).toEqual([]);
  });

  test("it refuses a step of two forms, one of none, an unknown member and a case with no command", () => {
    expect(cliStepsProblems([{ argv: ["a"], write: {} }])).not.toEqual([]);
    expect(cliStepsProblems([{ argv: ["a"] }, {}])).not.toEqual([]);
    expect(cliStepsProblems([{ argv: ["a"], extra: 1 }])).not.toEqual([]);
    expect(cliStepsProblems([{ write: { a: "x" } }])).toEqual([
      "steps holds at least one argv step",
    ]);
  });

  test("steps goes without a top-level argv", () => {
    expect(cliSpecProblems({ steps: [{ argv: ["a"] }], argv: ["b"] })).not.toEqual([]);
  });

  test("a write step creates directories, a remove step deletes, and neither leaves the root", () => {
    const root = freshRoot();

    applyTreeStep(root, { write: { "deep/er/file.txt": "text" } });
    expect(readFileSync(join(root, "deep/er/file.txt"), "utf8")).toBe("text");

    mkdirSync(join(root, "gone"));
    writeFileSync(join(root, "gone/a"), "");
    applyTreeStep(root, { remove: ["gone", "deep/er/file.txt"] });
    expect(existsSync(join(root, "gone"))).toBe(false);
    expect(existsSync(join(root, "deep/er/file.txt"))).toBe(false);

    expect(() => applyTreeStep(root, { write: { "../outside.txt": "x" } })).toThrow(
      /under the root/,
    );
    expect(() => applyTreeStep(root, { remove: ["absent"] })).toThrow(/absent/);
  });
});
