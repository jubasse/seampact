import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADR_0003_CASES,
  ADR_0015_CASES,
  AGREEMENT_DIRECTORY,
  AGREEMENT_ENTRY,
  type AgreementFiles,
  type AgreementRow,
  agreementProblems,
  agreementRows,
  readAgreementFiles,
} from "./agreement.ts";
import { type LoadedApi, loadGoldenCompiler } from "./compiler.ts";
import { REPO_ROOT } from "./repo-root.ts";

const compiler = await loadGoldenCompiler();
const loaded = compiler.loadValidated(join(REPO_ROOT, AGREEMENT_DIRECTORY), AGREEMENT_ENTRY);
const files = readAgreementFiles(REPO_ROOT);

function agreementApi(): LoadedApi {
  const [api] = loaded.apis;

  if (api === undefined) throw new Error("the agreement contract holds no api");

  return api;
}

function committedRows(): AgreementRow[] {
  return structuredClone(agreementRows(files.table));
}

function rowNamed(rows: AgreementRow[], id: string): AgreementRow {
  const row = rows.find((each) => each.id === id);

  if (row === undefined) throw new Error(`${id} is not a row of the committed table`);

  return row;
}

function tableOf(rows: readonly object[]): AgreementFiles {
  return { ...files, table: { rows } };
}

describe("validator agreement table", () => {
  it("validator agreement table is complete", () => {
    expect(loaded.problems).toEqual([]);
    expect(agreementProblems(files, agreementApi())).toEqual([]);
  });

  it("holds a row for every case of ADR 0015 and of ADR 0003", () => {
    const present = new Set(agreementRows(files.table).map((row) => row.case));

    expect([...ADR_0015_CASES, ...ADR_0003_CASES].filter((name) => !present.has(name))).toEqual([]);
  });

  it("refuses a row that names a schema the contract does not declare", () => {
    const rows = committedRows();

    rowNamed(rows, "Notice.assigned").schema = "Nothing";

    expect(agreementProblems(tableOf(rows), agreementApi())).toContain(
      "Notice.assigned: schema Nothing is not declared in the contract",
    );
  });

  it("refuses a row whose direction no route uses", () => {
    const api = agreementApi();
    const withoutRoutes: LoadedApi = { ...api, merged: { ...api.merged, surfaces: {} } };

    expect(agreementProblems(files, withoutRoutes)).toContain(
      "Notice.assigned: no route of the contract uses Notice as input",
    );
  });

  it("refuses a table that lacks a listed case", () => {
    const rows = committedRows();

    for (const row of rows) if (row.case === "opaque-value") delete row.case;

    expect(agreementProblems(tableOf(rows), agreementApi())).toEqual([
      "no row for the case opaque-value",
    ]);
  });

  it("refuses two rows with one id", () => {
    const rows = committedRows();

    rows.push({ ...rowNamed(rows, "Notice.assigned") });

    expect(agreementProblems(tableOf(rows), agreementApi())).toEqual([
      "Notice.assigned: the id is used by more than one row",
    ]);
  });

  it("refuses a row that breaks the table schema, naming its pointer", () => {
    const rows = committedRows();
    const pointer = `/rows/${rows.length}/expected`;

    const broken = { ...rowNamed(rows, "Notice.assigned"), id: "Notice.broken", expected: "maybe" };

    expect(agreementProblems(tableOf([...rows, broken]), agreementApi())).toContainEqual(
      expect.stringMatching(new RegExp(`^table\\.json${pointer}: `)),
    );
  });

  it("refuses payload text that is not JSON", () => {
    const rows = committedRows();

    rowNamed(rows, "Quantity.float-spelling").payloadText = "{count:";

    expect(agreementProblems(tableOf(rows), agreementApi())).toEqual([
      "Quantity.float-spelling: payloadText is not JSON text",
    ]);
  });

  it("refuses a received value on a refused payload", () => {
    const rows = committedRows();

    rowNamed(rows, "StrictKeys.root-unknown-key").received = { label: "a" };

    expect(agreementProblems(tableOf(rows), agreementApi())).toEqual([
      "StrictKeys.root-unknown-key: only an accepted input has a received value",
    ]);
  });
});
