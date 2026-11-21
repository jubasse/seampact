import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import type { OracleTools } from "./tool-modules.ts";

// `diff/result.json` and `diff/report.txt` of a case, and the one global `diff-table.json`.

export const DIFF_TABLE_FILE = "diff-table.json";
export const DEFAULT_DIFF_OPTIONS = { today: "2026-01-01" };

/** The IR of each api a side compiles to, by api name. */
export type SideIrs = ReadonlyMap<string, object>;

export function diffTableText(tools: OracleTools): string {
  return jsonText({ codes: tools.diffTable.codes, table: tools.diffTable.table });
}

/** `diffContracts` when each side holds one api, else `diffContractSets` with one report per api. */
export function diffFiles(
  tools: OracleTools,
  before: SideIrs,
  after: SideIrs,
  options: object,
): ExpectedFiles {
  const [onlyBefore] = [...before.values()];
  const [onlyAfter] = [...after.values()];

  if (
    before.size === 1 &&
    after.size === 1 &&
    onlyBefore !== undefined &&
    onlyAfter !== undefined
  ) {
    const result = tools.diffContracts(onlyBefore, onlyAfter, options);

    return new Map([
      ["diff/result.json", jsonText(result)],
      ["diff/report.txt", tools.formatDiffReport(result)],
    ]);
  }

  const results = tools.diffContractSets(before, after, options);
  const reports = [...results].map(
    ([api, result]) => `== ${api} ==\n${tools.formatDiffReport(result)}`,
  );

  return new Map([
    ["diff/result.json", jsonText(Object.fromEntries(results))],
    ["diff/report.txt", reports.join("\n")],
  ]);
}
