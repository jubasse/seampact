import type { SourceMap } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Diagnostic } from "./diagnostic.js";
import { printDiagnostics, sortDiagnostics } from "./print.js";

const site = (file: string, line: number, column: number) => ({
  file,
  line,
  column,
  endLine: line,
  endColumn: column + 1,
});

const locations: SourceMap["locations"] = {
  "api#/surfaces/app/routes/exportTasks": site("tasks/api.yaml", 42, 9),
  "api#/b": site("tasks/api.yaml", 42, 9),
  "api#/c": site("tasks/api.yaml", 7, 3),
  "base#/d": site("base.yaml", 99, 1),
  "tasks:api#/e": site("tasks/api.yaml", 42, 10),
};

const d = (
  rule: string,
  pointer: string,
  layer: "api" | "base" = "api",
  extra = {},
): Diagnostic => ({
  severity: "error",
  rule,
  message: "m",
  fix: "f",
  origin: { layer, pointer },
  related: [],
  ...extra,
});

test("printer sorts and formats", () => {
  // ADR 0006 section 4, byte for byte.
  const adr = d("seampact/access/deny-by-default", "/surfaces/app/routes/exportTasks", "api", {
    message: "route 'exportTasks' has no identity and no public access",
    fix: "set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'",
  });
  expect(printDiagnostics([adr], locations)).toBe(
    "tasks/api.yaml:42:9: error seampact/access/deny-by-default: route 'exportTasks' has no identity and no public access. Fix: set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'.",
  );
  // A message that already ends with a period prints the same line.
  const dotted = { ...adr, message: `${adr.message}.`, fix: `${adr.fix}.` };
  expect(printDiagnostics([dotted], locations)).toBe(printDiagnostics([adr], locations));

  // Sorted by file, line, column, then rule; related locations indented below.
  const withRelated = d("seampact/load/z", "/b", "api", {
    related: [{ origin: { layer: "base", pointer: "/d" }, message: "first declared here" }],
  });
  const out = printDiagnostics(
    [
      d("seampact/load/z-last", "/b"),
      withRelated,
      d("seampact/load/a-first", "/b"),
      d("seampact/load/any", "/d", "base"),
      d("seampact/load/c", "/c"),
      {
        ...d("seampact/load/api-scoped", "/e"),
        origin: { api: "tasks", layer: "api", pointer: "/e" },
      },
    ],
    locations,
  );
  expect(out.split("\n")).toEqual([
    "base.yaml:99:1: error seampact/load/any: m. Fix: f.",
    "tasks/api.yaml:7:3: error seampact/load/c: m. Fix: f.",
    "tasks/api.yaml:42:9: error seampact/load/a-first: m. Fix: f.",
    "tasks/api.yaml:42:9: error seampact/load/z: m. Fix: f.",
    "  base.yaml:99:1: first declared here.",
    "tasks/api.yaml:42:9: error seampact/load/z-last: m. Fix: f.",
    "tasks/api.yaml:42:10: error seampact/load/api-scoped: m. Fix: f.",
  ]);
  expect(out.includes(String.fromCharCode(27))).toBe(false);
  expect(out).not.toContain("/home/");
});

test("printer sorting is stable whatever the input order", () => {
  const list = [
    d("seampact/load/b", "/c"),
    d("seampact/load/a", "/b"),
    d("seampact/load/c", "/d", "base"),
  ];
  const forward = sortDiagnostics(list, locations).map((x) => x.rule);
  const reverse = sortDiagnostics([...list].reverse(), locations).map((x) => x.rule);
  expect(reverse).toEqual(forward);
});
