import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { LINT_RESERVED_RULE_IDS, seampactCorePlugin } from "./core/plugin.js";
import { lintRuleId } from "./plugin.js";

// The grammar's table of the core rules is the reference: the code and the doc cannot drift (CHK-137).

const GRAMMAR = fileURLToPath(
  new URL("../../../../docs/grammar/12-enums-examples-docs-extensions.md", import.meta.url),
);

interface TableRow {
  id: string;
  defaultSeverity: string;
  reports: string;
  silencedOn: string;
}

function coreTable(): TableRow[] {
  return readFileSync(GRAMMAR, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("| `seampact/"))
    .map((line) => {
      const [id = "", defaultSeverity = "", reports = "", silencedOn = ""] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      return { id: id.replaceAll("`", ""), defaultSeverity, reports, silencedOn };
    });
}

test("the core rules are the grammar's table, less the reserved ids", () => {
  const table = coreTable();
  const implemented = table.filter((row) => !LINT_RESERVED_RULE_IDS.includes(row.id));

  expect(table.length).toBe(implemented.length + LINT_RESERVED_RULE_IDS.length);
  expect(
    seampactCorePlugin.rules.map((rule) => ({
      id: lintRuleId(seampactCorePlugin, rule),
      defaultSeverity: rule.defaultSeverity,
      reports: rule.reports,
      silencedOn: rule.silencedOn,
    })),
  ).toEqual(implemented);
});

test("every reserved id is in the table", () => {
  const ids = coreTable().map((row) => row.id);

  for (const reserved of LINT_RESERVED_RULE_IDS) expect(ids).toContain(reserved);
});
