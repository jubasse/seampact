import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IR_REVISION, IR_SCHEMA_DOCUMENTS, MUST_ACT_KEYWORD } from "@seampact/spec/ir";
import { describe, expect, it } from "vitest";
import {
  CORPUS_FILE,
  type CorpusCase,
  type CorpusSupport,
  documentTextOf,
  generateCorpus,
  MUST_ACT_CODE,
  verdictOf,
} from "./corpus.ts";
import { findStaleFiles } from "./generate.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface CommittedCorpus {
  irRevision: number;
  supports: Record<string, CorpusSupport>;
  cases: CorpusCase[];
}

function committedCorpus(): CommittedCorpus {
  return JSON.parse(readFileSync(join(REPO, CORPUS_FILE), "utf8"));
}

function mustActDefinitionNames(): string[] {
  return IR_SCHEMA_DOCUMENTS.flatMap((document) =>
    Object.entries((document.$defs ?? {}) as Record<string, Record<string, unknown>>)
      .filter(([, definition]) => definition[MUST_ACT_KEYWORD] === true)
      .map(([name]) => name),
  );
}

describe("the reader parity corpus", () => {
  it("parity verdicts are current", () => {
    expect(findStaleFiles(generateCorpus(), REPO)).toEqual([]);
  });

  it("the TypeScript reader gives every committed verdict", () => {
    const { supports, cases } = committedCorpus();

    expect(cases.length).toBeGreaterThan(0);

    for (const testCase of cases) {
      const support = supports[testCase.support];

      expect(support, `${testCase.id}: support`).toBeDefined();

      if (support === undefined) continue;

      expect(verdictOf(documentTextOf(testCase), support), testCase.id).toEqual(testCase.verdict);
    }
  });

  it("the committed supports read the revision of this IR", () => {
    const { irRevision, supports } = committedCorpus();

    expect(irRevision).toBe(IR_REVISION);

    for (const support of Object.values(supports)) expect(support.irRevision).toBe(IR_REVISION);
  });

  it("every must-act definition has a case that refuses its unknown", () => {
    const refusedDefinitions = committedCorpus()
      .cases.filter((testCase) => testCase.id.startsWith("must-act/"))
      .map((testCase) => {
        expect(testCase.verdict.outcome, testCase.id).toBe("refuse");

        return testCase.id.slice("must-act/".length);
      });

    expect(refusedDefinitions.sort()).toEqual(mustActDefinitionNames().sort());
  });

  it("a verdict holds the outcome and the refusal fields, never a message", () => {
    for (const { id, verdict } of committedCorpus().cases) {
      if (verdict.outcome !== "refuse") {
        expect(Object.keys(verdict), id).toEqual(["outcome"]);
        continue;
      }

      expect(verdict.refusals.length, id).toBeGreaterThan(0);

      for (const refusal of verdict.refusals) {
        const keys = Object.keys(refusal);
        const refusalKeys = ["code", "member", "value", "expected", "operation"];

        expect(keys.slice(0, 2), id).toEqual(["code", "member"]);
        expect(
          keys.every((key) => refusalKeys.includes(key)),
          id,
        ).toBe(true);

        // A support refusal always has an expected list; a must-act one has its string value only.
        if (refusal.code === MUST_ACT_CODE) expect(keys, id).toEqual(["code", "member", "value"]);
        else expect(keys, id).toContain("expected");
      }
    }
  });

  it("covers each outcome, the PR 42 number literals, the catalogue keys and the standalone tags", () => {
    const cases = committedCorpus().cases;
    const outcomes = new Set(cases.map((testCase) => testCase.verdict.outcome));
    const ids = cases.map((testCase) => testCase.id);

    expect([...outcomes].sort()).toEqual(["accept", "malformed", "not-json", "refuse"]);
    expect(ids).toContain("literal/revision-fraction-rounds-down");
    expect(ids).toContain("literal/revision-java-double-suffix");
    expect(ids).toContain("literal/status-beyond-safe-range");
    expect(ids).toContain("literal/extension-java-double-suffix");
    expect(ids).toContain("literal/extension-nan");
    expect(ids).toContain("catalogue/right-proto-key");
    expect(ids).toContain("catalogue/error-numeric-key");
    expect(ids).toContain("standalone-tag/missing");
    expect(
      cases.some(
        (testCase) =>
          testCase.verdict.outcome === "refuse" &&
          testCase.verdict.refusals.some((refusal) => refusal.code === MUST_ACT_CODE),
      ),
    ).toBe(true);
  });

  it("a literal is written into the document text as given", () => {
    const text = documentTextOf({
      id: "literal/probe",
      example: "minimal.ir.json",
      support: "http",
      literals: [{ pointer: "/irRevision", text: "3.0000000000000000001" }],
    });

    expect(text).toContain('"irRevision":3.0000000000000000001,');
  });

  it("an edit that points nowhere fails instead of being skipped", () => {
    expect(() =>
      documentTextOf({
        id: "edit/probe",
        example: "minimal.ir.json",
        support: "http",
        edits: [{ pointer: "/absent/member", remove: true }],
      }),
    ).toThrow();
  });
});
