import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_DIRECTORY,
  AGREEMENT_ENTRY,
  type AgreementRow,
  agreementRows,
  readAgreementFiles,
} from "../golden/agreement.ts";
import { loadGoldenCompiler } from "../golden/compiler.ts";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { generatedSubset } from "./generated-subset.ts";
import { loadProviderValidators, validatorProviderIds } from "./providers.ts";

// The schemas of the agreement table that no validator runs yet, each with why: all three providers refuse its
// form, or it is no named schema of the IR. Removing a name here is the proof that its form now generates.
const NOT_RUN_YET: Readonly<Record<string, string>> = {
  Comment: "a schema that refers to itself is refused",
  Counts: "a map (additionalProperties, propertyNames) is refused",
  Day: "the date format is refused",
  Formats: "the email, uri, uri-reference, int64 and decimal formats are refused",
  IgnoreKeys: "unknownKeys ignore on an operation input is refused",
  KeepKeys: "unknownKeys keep on an operation input is refused",
  Notice: "a root tagged union is refused",
  Owner: "an enum narrowed to some members is refused",
  PatchArticle: "a nullable property and the date format are refused",
  Receipt: "a nullable scalar property is refused",
  SubtreeKeys: "unknownKeys ignore on a property is refused",
  Tags: "an array root is no named schema of the IR",
};

// Rows on which the three validators agree with each other and give the opposite of the table's verdict; a
// disagreement with ADR 0003 is fixed in the validators; only a gap upstream of them stays listed.
const VALIDATORS_DIVERGE_FROM_TABLE: Readonly<Record<string, string>> = {
  "OptionalEnvelope.null":
    "the compiler writes no nullable on an opaque property, so the IR holds it as non-nullable",
};

const compiler = await loadGoldenCompiler();
const compiled = compiler.compile(join(REPO_ROOT, AGREEMENT_DIRECTORY), AGREEMENT_ENTRY);
const irText = compiled.apis[0]?.files?.irText;

if (irText === undefined) {
  throw new Error(`the agreement contract does not compile: ${compiled.problems.join("; ")}`);
}

const subset = await generatedSubset(JSON.parse(irText));
const tableRows = agreementRows(readAgreementFiles(REPO_ROOT).table);
const rows = tableRows.filter((row) => Object.hasOwn(subset.schemas, row.schema));
const providers = await Promise.all(
  validatorProviderIds().map((id) => loadProviderValidators(id, subset.ir)),
);

function payloadOf(row: AgreementRow): unknown {
  return row.payloadText === undefined ? row.payload : JSON.parse(row.payloadText);
}

function verdictsOf(row: AgreementRow) {
  return Promise.all(providers.map((provider) => provider.verdictOf(row, payloadOf(row))));
}

describe("validator agreement runner", () => {
  it("covers every validators provider of the compatibility matrix", () => {
    expect(providers.map((provider) => provider.id)).toEqual(validatorProviderIds());
    expect(providers.length).toBeGreaterThan(1);
  });

  it("names the schemas it does not run", () => {
    const notRun = new Set(tableRows.map((row) => row.schema));

    for (const name of Object.keys(subset.schemas)) notRun.delete(name);

    expect([...notRun].sort()).toEqual(Object.keys(NOT_RUN_YET).sort());
  });

  it.each(rows)(
    "$id: the providers give one verdict and name the same contract rules",
    async (row) => {
      const results = await verdictsOf(row);
      const [first, ...others] = results;

      for (const other of others) {
        expect(other.verdict).toBe(first?.verdict);
        expect(other.rules).toEqual(first?.rules);
      }
    },
  );

  it.each(rows.filter((row) => row.received !== undefined))(
    "$id: the providers hand over the received value",
    async (row) => {
      for (const result of await verdictsOf(row)) expect(result.value).toEqual(row.received);
    },
  );

  it.each(rows.filter((row) => !(row.id in VALIDATORS_DIVERGE_FROM_TABLE)))(
    "$id: the providers give the table verdict",
    async (row) => {
      for (const result of await verdictsOf(row)) expect(result.verdict).toBe(row.expected);
    },
  );

  it.each(Object.keys(VALIDATORS_DIVERGE_FROM_TABLE))(
    "%s: the providers still give the verdict the table does not",
    async (id) => {
      const row = rows.find((each) => each.id === id);

      if (row === undefined) throw new Error(`${id} is not a row the runner runs`);

      for (const result of await verdictsOf(row)) expect(result.verdict).not.toBe(row.expected);
    },
  );
});
