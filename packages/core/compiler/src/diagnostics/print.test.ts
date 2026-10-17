import type { SourceMap } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Diagnostic } from "./diagnostic.js";
import { diagnosticLocation, diagnosticSort, printDiagnostics } from "./print.js";

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
  "api#/e": site("tasks/api.yaml", 42, 10),
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
  const forward = diagnosticSort(list, locations).map((x) => x.rule);
  const reverse = diagnosticSort([...list].reverse(), locations).map((x) => x.rule);

  expect(reverse).toEqual(forward);
});

test("the location key is the origin's layer and pointer, never its api", () => {
  // The caller passes the table of the api the origin belongs to (ADR 0004 section 11).
  expect(diagnosticLocation({ api: "tasks", layer: "api", pointer: "/e" }, locations)).toEqual(
    site("tasks/api.yaml", 42, 10),
  );
  expect(diagnosticLocation({ layer: "api", pointer: "/missing" }, locations).file).toBe(
    "(unknown location)",
  );
  expect(diagnosticLocation({ layer: "api", pointer: "/toString" }, {}).file).toBe(
    "(unknown location)",
  );
});

test("the location key ignores the origin's api, where the old key put it first", () => {
  // The first key format was `<api>:<layer>#<pointer>` when the origin named an api; the table
  // of the api the origin belongs to is keyed `<layer>#<pointer>` only.
  const table = { "tasks:api#/e": site("old.yaml", 1, 1), "api#/e": site("new.yaml", 2, 2) };

  expect(diagnosticLocation({ api: "tasks", layer: "api", pointer: "/e" }, table).file).toBe(
    "new.yaml",
  );
  const oldOnly = { "tasks:api#/e": site("old.yaml", 1, 1) };

  expect(diagnosticLocation({ api: "tasks", layer: "api", pointer: "/e" }, oldOnly).file).toBe(
    "(unknown location)",
  );
});

test("printer escapes every control and format character, zero-width and tag ones included", () => {
  const cases: [string, string][] = [
    ["\u061C", "\\u061C"], // Arabic letter mark
    ["\u200B", "\\u200B"], // zero-width space
    ["\u200C", "\\u200C"],
    ["\u200D", "\\u200D"], // zero-width joiner
    ["\u2060", "\\u2060"], // word joiner
    ["\u2061", "\\u2061"],
    ["\u2062", "\\u2062"],
    ["\u2063", "\\u2063"],
    ["\u2064", "\\u2064"],
    ["\u00AD", "\\u00AD"], // soft hyphen, another Cf
    ["\u{E0041}", "\\u{E0041}"], // a tag character, beyond the basic plane
    ["\uD800", "\\uD800"], // a lone surrogate
  ];

  for (const [ch, shown] of cases) {
    const out = printDiagnostics(
      [d("seampact/load/x", "/t", "api", { message: `a${ch}b`, fix: "f" })],
      { "api#/t": site(`f${ch}.yaml`, 1, 1) },
    );

    expect(out, shown).toBe(`f${shown}.yaml:1:1: error seampact/load/x: a${shown}b. Fix: f.`);
  }

  // The byte order mark: a file name keeps it escaped (a message folds it as white space).
  const bom = printDiagnostics([d("seampact/load/x", "/t")], {
    "api#/t": site("\uFEFFf.yaml", 1, 1),
  });

  expect(bom).toBe("\\uFEFFf.yaml:1:1: error seampact/load/x: m. Fix: f.");
});

test("printer escapes control and bidirectional characters from authored text", () => {
  const esc = String.fromCharCode(27);
  const tricky = {
    "api#/t": site(`a${esc}[2Jb‮.yaml`, 1, 1),
    "api#/r": site("r.yaml", 2, 1),
  };
  const out = printDiagnostics(
    [
      d("seampact/load/x", "/t", "api", {
        message: `key '${esc}[31mred\u0007' ‎hidden⁦⁩ \u009B1m del\u007F`,
        fix: `drop‭it‏`,
        related: [{ origin: { layer: "api", pointer: "/r" }, message: `here${esc}]0;title` }],
      }),
    ],
    tricky,
  );

  expect(out).toBe(
    [
      "a\\u001B[2Jb\\u202E.yaml:1:1: error seampact/load/x: key '\\u001B[31mred\\u0007' \\u200Ehidden\\u2066\\u2069 \\u009B1m del\\u007F. Fix: drop\\u202Dit\\u200F.",
      "  r.yaml:2:1: here\\u001B]0;title.",
    ].join("\n"),
  );
  // Nothing a terminal would act on is left.
  const active = [...out].filter((ch) => {
    const c = ch.charCodeAt(0);

    return (c <= 0x1f && c !== 0x0a) || (c >= 0x7f && c <= 0x9f) || (c >= 0x200e && c <= 0x206f);
  });

  expect(active).toEqual([]);
});
