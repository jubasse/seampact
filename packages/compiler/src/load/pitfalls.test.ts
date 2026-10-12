import { expect, test } from "vitest";
import { diagnosticLocation } from "../diagnostics/print.js";
import { expectGolden, loadFixture } from "./golden.js";
import { loadScalarPitfall } from "./index.js";

// One fixture per case under fixtures/loader/pitfalls: [pitfall, case, directory, rules expected].
const CASES: [string, string, string, string[]][] = [
  ["P1", "no", "p1-no", ["yaml-boolean"]],
  ["P1", "yes on off y n Yes OFF", "p1-yes-on-off", ["yaml-boolean"]],
  ["P1", "True FALSE TRUE", "p1-boolean-case", ["yaml-boolean"]],
  ["P1", "key", "p1-key", ["yaml-boolean"]],
  ["P2", "octal 012", "p2-octal", ["yaml-number-format"]],
  ["P2", "0o12 0x1F", "p2-hex-octal-prefix", ["yaml-number-format"]],
  ["P2", "+1 1e3", "p2-sign-exp", ["yaml-number-format"]],
  ["P2", ".5 1.", "p2-dots", ["yaml-number-format"]],
  ["P2", ".inf .nan", "p2-inf-nan", ["yaml-number-format"]],
  ["P3", "1_000 0b101", "p3-underscore-binary", ["yaml-ambiguous-scalar"]],
  ["P3", "sexagesimal 1:30", "p3-sexagesimal", ["yaml-ambiguous-scalar"]],
  ["P3", "date and timestamp", "p3-date-timestamp", ["yaml-ambiguous-scalar"]],
  ["P4", "= and <<", "p4-equals-value", ["yaml-reserved-scalar"]],
  ["P5", "anchor and alias", "p5-anchor-alias", ["yaml-anchor"]],
  ["P5", "merge key", "p5-merge-key", ["yaml-anchor"]],
  ["P7", "duplicate inline", "p7-duplicate-inline", ["duplicate-key"]],
  ["P7", "duplicate through include", "p7-duplicate-include", ["duplicate-key"]],
  ["P8", "include cycle", "p8-include-cycle", ["include-cycle"]],
  ["P9", "two documents", "p9-two-documents", ["yaml-document"]],
  ["P9", "tag", "p9-tag", ["yaml-tag"]],
  ["data", "null spellings in a data position", "data-null", ["data-null"]],
];

for (const [pitfall, name, dir, rules] of CASES) {
  test(`pitfall ${pitfall} ${name}`, () => {
    const result = loadFixture(`pitfalls/${dir}`);
    const printed = expectGolden(`pitfalls/${dir}`, result);
    const found = new Set(result.diagnostics.map((d) => d.rule.replace("seampact/load/", "")));
    expect([...found].sort()).toEqual([...rules].sort());
    // Each line names file, line, column, rule and fix.
    for (const line of printed.split("\n").filter((l) => !l.startsWith(" "))) {
      expect(line).toMatch(/^[^:]+:\d+:\d+: error seampact\/load\/[a-z0-9-]+: .+ Fix: .+\.$/);
    }
  });
}

test("pitfall P1 to P4 table: every listed scalar is refused", () => {
  const refused: [string, unknown, string][] = [
    ...[
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "on",
      "On",
      "ON",
      "off",
      "Off",
      "OFF",
      "True",
      "TRUE",
      "False",
      "FALSE",
    ].map((s): [string, unknown, string] => [s, s, "P1"]),
    ["012", 12, "P2"],
    ["0o12", 10, "P2"],
    ["0x1F", 31, "P2"],
    ["+1", 1, "P2"],
    ["1e3", 1000, "P2"],
    [".5", 0.5, "P2"],
    ["1.", 1, "P2"],
    [".inf", Number.POSITIVE_INFINITY, "P2"],
    [".nan", Number.NaN, "P2"],
    ["1_000", "1_000", "P3"],
    ["0b101", "0b101", "P3"],
    ["1:30", "1:30", "P3"],
    ["2027-06-30", "2027-06-30", "P3"],
    ["2027-06-30T10:00:00Z", "2027-06-30T10:00:00Z", "P3"],
    ["=", "=", "P4"],
    ["<<", "<<", "P4"],
  ];
  for (const [source, resolved, rule] of refused) {
    expect(loadScalarPitfall(source, resolved), source).toBe(rule);
  }
});

test("pitfall P1 to P4 near misses pass", () => {
  const ok: [string, unknown][] = [
    ["true", true],
    ["false", false],
    ["0", 0],
    ["-1", -1],
    ["-1.5", -1.5],
    ["12", 12],
    ["0.5", 0.5],
    ["yesterday", "yesterday"],
    ["nope", "nope"],
    ["null", null],
    ["tasks.update", "tasks.update"],
    ["2027-06", "2027-06"],
    ["1:30pm", "1:30pm"],
    ["300ms", "300ms"],
  ];
  for (const [source, resolved] of ok) {
    expect(loadScalarPitfall(source, resolved), source).toBeUndefined();
  }
});

test("all errors of the load stage are reported in one run, sorted", () => {
  const result = loadFixture("pitfalls/p1-yes-on-off");
  expect(result.diagnostics.length).toBe(7);
  const lines = result.diagnostics.map(
    (d) => diagnosticLocation(d.origin, result.workspace.locations).line,
  );
  expect(lines).toEqual([3, 4, 5, 6, 7, 8, 9]);
});
