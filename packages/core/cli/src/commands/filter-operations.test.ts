import { readFileSync } from "node:fs";
import { checkIrInvariants, type ContractIR, createIrValidator } from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import { type FilterOutcome, filterOperations } from "./filter-operations.js";

const TASKS_IR_FILE = new URL(
  "../../../../../fixtures/golden/reference/tasks.ir.json",
  import.meta.url,
);

const strictValidator = createIrValidator(Ajv2020, "strict");

function isValidIr(value: unknown): value is ContractIR {
  return strictValidator.validate(value).valid;
}

function readTasksIr(): ContractIR {
  const value: unknown = JSON.parse(readFileSync(TASKS_IR_FILE, "utf8"));

  if (!isValidIr(value)) throw new Error(`${TASKS_IR_FILE.pathname} is not a valid IR`);

  return value;
}

function keptIds(outcome: FilterOutcome): string[] {
  if (outcome.status === "refused") throw new Error(`refused: ${JSON.stringify(outcome.problems)}`);

  return outcome.ir.operations.map((operation) => operation.id);
}

function expectValidIr(outcome: FilterOutcome): void {
  if (outcome.status === "refused") throw new Error(`refused: ${JSON.stringify(outcome.problems)}`);

  expect(isValidIr(outcome.ir)).toBe(true);
  expect(checkIrInvariants(outcome.ir)).toEqual([]);
}

test("keeps the operations of the entry's document and operations filter", () => {
  const ir = readTasksIr();
  const allIds = ir.operations.map((operation) => operation.id);

  const publicOnly = filterOperations(ir, { document: "public" });

  expect(keptIds(publicOnly)).toEqual(
    allIds.filter((id) => id !== "archiveTask" && id !== "payments"),
  );
  expectValidIr(publicOnly);

  const included = filterOperations(ir, { operations: { include: ["getTask", "listTasks"] } });

  expect(keptIds(included)).toEqual(["getTask", "listTasks"]);
  expectValidIr(included);

  const excluded = filterOperations(ir, { document: "full", operations: { exclude: ["health"] } });

  expect(keptIds(excluded)).toEqual(allIds.filter((id) => id !== "health"));
  expectValidIr(excluded);

  expect(filterOperations(ir, { operations: { include: ["nope"] } })).toMatchObject({
    status: "refused",
    problems: [{ code: "filter.operation.unknown", message: expect.stringContaining("'nope'") }],
  });
  expect(filterOperations(ir, { document: "partners" })).toMatchObject({
    status: "refused",
    problems: [{ code: "filter.document.unknown", message: expect.stringContaining("'partners'") }],
  });
  expect(ir.operations.map((operation) => operation.id)).toEqual(allIds);
});

test("refuses an include item that the document already removed", () => {
  const ir = readTasksIr();

  expect(
    filterOperations(ir, { document: "public", operations: { include: ["archiveTask"] } }),
  ).toMatchObject({
    status: "refused",
    problems: [
      { code: "filter.include.removed", message: expect.stringContaining("'archiveTask'") },
    ],
  });
});
