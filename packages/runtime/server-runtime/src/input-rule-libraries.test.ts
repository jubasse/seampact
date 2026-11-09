import { Ajv } from "ajv";
import { describe, expect, test } from "vitest";
import { object as yupObject, string as yupString } from "yup";
import { z } from "zod";
import {
  INPUT_RULE_ADAPTERS,
  type InputRuleSchema,
  inputRuleLibraryOf,
  yupPathPointer,
} from "./input-rule-libraries.js";

const WINDOW = { start: "2026-01-02", end: "2026-01-01" };
const STORE_DOWN = new Error("the rule store is down");

describe("zod rules", () => {
  const adapter = INPUT_RULE_ADAPTERS.zod;
  const schema = z
    .object({ start: z.string(), end: z.string() })
    .refine((value) => value.end > value.start, {
      path: ["end"],
      params: { rule: "endAfterStart" },
    });

  test("a refusal gives the refinement's path and its params.rule", async () => {
    await expect(adapter.refusals(schema, WINDOW)).resolves.toEqual([
      { pointer: "/end", name: "endAfterStart" },
    ]);
  });

  test("a passing value gives no refusal", async () => {
    await expect(adapter.refusals(schema, { start: "a", end: "b" })).resolves.toEqual([]);
  });

  test("a refinement without params gives no name", async () => {
    const unnamed = z.object({ start: z.string() }).refine(() => false);

    await expect(adapter.refusals(unnamed, { start: "a" })).resolves.toEqual([
      { pointer: "", name: undefined },
    ]);
  });

  test("an async refinement that rejects rejects", async () => {
    const failing = z.string().refine(() => Promise.reject(STORE_DOWN));

    await expect(adapter.refusals(failing, "a")).rejects.toBe(STORE_DOWN);
  });

  test("accepts a zod schema only", () => {
    expect(adapter.accepts(schema)).toBe(true);
    expect(adapter.accepts(yupString())).toBe(false);
  });
});

describe("yup rules", () => {
  const adapter = INPUT_RULE_ADAPTERS.yup;
  const schema = yupObject({ start: yupString().required(), end: yupString().required() }).test({
    name: "endAfterStart",
    test: (value, context) =>
      value.end > value.start || context.createError({ path: "end", message: "end before start" }),
  });

  test("a refusal gives the test's path and name", async () => {
    await expect(adapter.refusals(schema, WINDOW)).resolves.toEqual([
      { pointer: "/end", name: "endAfterStart" },
    ]);
  });

  test("a yup schema types the rules of an api whose generated validators are yup", () => {
    type GeneratedYupValidator = { readonly "~standard": { readonly vendor: "yup" } };
    const typedRule: InputRuleSchema<GeneratedYupValidator, { start: string; end: string }> =
      schema;

    expect(typedRule).toBe(schema);
  });

  test("every failing test is reported, not only the first", async () => {
    const twoRules = yupObject({
      start: yupString().test({ name: "first", test: () => false }),
      end: yupString().test({ name: "second", test: () => false }),
    });

    await expect(adapter.refusals(twoRules, WINDOW)).resolves.toEqual([
      { pointer: "/start", name: "first" },
      { pointer: "/end", name: "second" },
    ]);
  });

  test("a test that throws another error rejects with it", async () => {
    const failing = yupString().test({
      name: "throws",
      test: () => {
        throw STORE_DOWN;
      },
    });

    await expect(adapter.refusals(failing, "a")).rejects.toBe(STORE_DOWN);
  });

  test("a yup path becomes a JSON pointer with array indices and quoted keys", () => {
    expect(yupPathPointer("items[0].end")).toBe("/items/0/end");
    expect(yupPathPointer('["a.b"].c')).toBe("/a.b/c");
    expect(yupPathPointer(undefined)).toBe("");
  });
});

describe("Ajv rules", () => {
  const adapter = INPUT_RULE_ADAPTERS.ajv;
  const ajv = new Ajv({ allErrors: true });

  ajv.addKeyword({
    keyword: "endAfterStart",
    type: "object",
    validate: (_schema: unknown, data: { start: string; end: string }) => data.end > data.start,
  });

  test("a refusal gives the keyword and the instance path", async () => {
    const validate = ajv.compile({
      type: "object",
      properties: { window: { type: "object", endAfterStart: true } },
    });

    await expect(adapter.refusals(validate, { window: WINDOW })).resolves.toEqual([
      { pointer: "/window", name: "endAfterStart" },
    ]);
  });

  test("an $async schema that refuses gives its errors", async () => {
    const validate = ajv.compile({ $async: true, type: "object", endAfterStart: true });

    await expect(adapter.refusals(validate, WINDOW)).resolves.toEqual([
      { pointer: "", name: "endAfterStart" },
    ]);
  });

  test("accepts a compiled validate function only", () => {
    expect(adapter.accepts(ajv.compile({ type: "string" }))).toBe(true);
    expect(adapter.accepts(() => true)).toBe(false);
  });
});

test("the library is the generated validator's Standard Schema vendor", () => {
  expect(inputRuleLibraryOf(z.string())).toBe("zod");
  expect(inputRuleLibraryOf(yupString())).toBe("yup");
  expect(inputRuleLibraryOf({ "~standard": { vendor: "valibot" } })).toBeUndefined();
});
