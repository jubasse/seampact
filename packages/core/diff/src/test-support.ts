// Shared by the diff tests only: golden IRs, and pairs built by cloning one and editing a member.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ContractIR,
  isKnownVariant,
  type KnownSchema,
  type ObjectSchema,
  type Operation,
} from "@seampact/spec/ir";
import { diffContracts } from "./diff-contracts.js";
import type { DiffOptions } from "./options.js";
import type { DiffChange, DiffResult } from "./result.js";

export const TODAY = "2026-10-20";

const GOLDEN_ROOT = fileURLToPath(new URL("../../../../fixtures/golden/", import.meta.url));

const REFERENCE_IR = "reference/tasks.ir.json";

export function goldenIr(relative: string = REFERENCE_IR): ContractIR {
  return JSON.parse(readFileSync(join(GOLDEN_ROOT, relative), "utf8"));
}

/** Every golden IR file, relative to `fixtures/golden`. */
export function goldenIrFiles(): string[] {
  return readdirSync(GOLDEN_ROOT, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ir.json"))
    .sort();
}

/** A copy of `base` (the reference IR by default) with `edit` applied. */
export function editedIr(
  edit: (ir: ContractIR) => void,
  base: ContractIR = goldenIr(),
): ContractIR {
  const copy = structuredClone(base);

  edit(copy);

  return copy;
}

export function operationOf(ir: ContractIR, id: string): Operation {
  const operation = ir.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`no operation ${id} in the test IR`);

  return operation;
}

export function objectSchemaOf(ir: ContractIR, id: string): ObjectSchema {
  const schema = knownSchemaOf(ir, id);

  if (schema.kind !== "object") throw new Error(`schema ${id} of the test IR is no object`);

  return schema;
}

export function knownSchemaOf(ir: ContractIR, id: string): KnownSchema {
  const schema = ir.schemas[id];

  if (schema === undefined || !isKnownVariant("Schema", schema))
    throw new Error(`no schema ${id} in the test IR`);

  return schema;
}

export function diffOk(
  before: ContractIR,
  after: ContractIR,
  options: Partial<DiffOptions> = {},
): Extract<DiffResult, { ok: true }> {
  const result = diffContracts(before, after, { today: TODAY, ...options });

  if (!result.ok) throw new Error(`the diff was refused: ${JSON.stringify(result.refusals)}`);

  return result;
}

/** The changes of the pair, informative ones left out unless asked for. */
export function changesOf(before: ContractIR, after: ContractIR): DiffChange[] {
  return diffOk(before, after).changes;
}
