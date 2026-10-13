import type { ContractIR, IrWriter, UnknownVariant } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { createDraftIR, type DraftIR, type DraftOperation } from "./draft.js";

const origin: IrWriter.Origin = { layer: "api", pointer: "/surfaces/app/routes/health" };

test("writer view refuses unknown variants", () => {
  const operation: DraftOperation = {
    kind: "httpOperation",
    // @ts-expect-error an open enum: the writer view knows only its listed values
    method: "trace",
    // @ts-expect-error a must-act union: no unknown tag
    access: { kind: "sometimes", origin },
  };
  // @ts-expect-error a union: no unknown tag in a type use
  const body: IrWriter.TypeUse = { kind: "tuple", items: [] };
  const unknownArm: UnknownVariant<"kind"> = { kind: "cookieJar" };
  // @ts-expect-error the reader's unknown arm is no writer value
  const scheme: IrWriter.Scheme = unknownArm;
  // @ts-expect-error an open enum inside a catalogue entry
  const maturity: IrWriter.Service = { id: "mail", maturity: "beta", origin };
  // @ts-expect-error an operation's features are finalize's: no half writes them
  const features: DraftOperation = { kind: "httpOperation", features: [] };
  expect([operation, body, scheme, maturity, features]).toHaveLength(5);
});

test("a complete draft, with finalize's members, is a ContractIR", () => {
  type Complete = Omit<Required<DraftIR>, "operations"> & { operations: IrWriter.Operation[] };
  type FinalizeMembers = "irVersion" | "irRevision" | "kinds" | "features";
  const assignable: [
    Complete extends Omit<ContractIR, FinalizeMembers> ? true : false,
    IrWriter.Operation extends DraftOperation ? true : false,
  ] = [true, true];
  expect(assignable).toEqual([true, true]);
});

test("a new draft holds empty catalogues without a prototype", () => {
  const draft = createDraftIR();
  expect(draft.operations).toEqual([]);
  expect(draft.packs).toEqual([]);
  expect(draft.api).toBeUndefined();
  expect(Object.getPrototypeOf(draft.rights)).toBeNull();
  const right: IrWriter.Right = {
    id: "__proto__",
    subject: { kind: "none" },
    errors: [],
    docs: {},
    extensions: {},
    origin,
  };
  const key = "__proto__";
  draft.rights[key] = right;
  expect(Object.hasOwn(draft.rights, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(draft.rights)).toBeNull();
  expect(JSON.parse(JSON.stringify(draft.rights))).toEqual({ ["__proto__"]: right });
});
