import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedFiles } from "@seampact/codegen-core";
import { type ContractIR, isKnownVariant } from "@seampact/spec/ir";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { array, object, string, ValidationError } from "yup";
import { target } from "./index.js";

const GOLDEN_IR = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const YUP_PACKAGE = new URL("../node_modules/yup", import.meta.url).pathname;
const CHANNEL_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

interface Issue {
  path: readonly string[];
  params: { rule: string };
}

type Result = { value: unknown } | { issues: readonly Issue[] };

interface StandardValidator {
  "~standard": { validate(value: unknown): Promise<Result> };
}

// A yup object schema: also a Standard Schema, and the shape of its members for `pick` and `concat`.
interface ObjectValidator extends StandardValidator {
  fields: Record<string, StandardValidator>;
  validate(value: unknown, options: { abortEarly: boolean }): Promise<unknown>;
  pick(keys: string[]): ObjectValidator;
  concat(other: ObjectValidator): ObjectValidator;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-yup-run-"));

let standardSchemaOf: (schema: unknown) => StandardValidator;
let isMultipleOf: (value: number, step: number) => boolean;
let operationInputs: Record<string, StandardValidator>;
let inputSchemas: Record<string, ObjectValidator>;
let outputSchemas: Record<string, ObjectValidator>;

interface GeneratedModules {
  standardSchemaOf: (schema: unknown) => StandardValidator;
  isMultipleOf: (value: number, step: number) => boolean;
  operationInputs: Record<string, StandardValidator>;
  inputSchemas: Record<string, ObjectValidator>;
  outputSchemas: Record<string, ObjectValidator>;
}

// Generates the validators of an IR into a project that resolves `yup` to this package's copy, then imports them.
async function generateAndImport(ir: ContractIR, name: string): Promise<GeneratedModules> {
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["validators"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const root = join(temporaryRoot, name);
  const outDir = join(root, "generated");
  const written = await writeGeneratedFiles(outDir, "@seampact/codegen-yup", outcome.files);

  if (written.status !== "written") throw new Error(JSON.stringify(written.refusals));

  mkdirSync(join(root, "node_modules"));
  symlinkSync(YUP_PACKAGE, join(root, "node_modules", "yup"), "dir");
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');

  return {
    ...(await import(join(outDir, "yup-support.ts"))),
    operationInputs: await import(join(outDir, "operations/input.ts")),
    inputSchemas: await import(join(outDir, "schemas/input.ts")),
    outputSchemas: await import(join(outDir, "schemas/output.ts")),
  };
}

function goldenIr(): ContractIR {
  return JSON.parse(readFileSync(GOLDEN_IR, "utf8"));
}

beforeAll(async () => {
  ({ standardSchemaOf, isMultipleOf, operationInputs, inputSchemas, outputSchemas } =
    await generateAndImport(goldenIr(), "generated-root"));
});

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function validate(validator: StandardValidator | undefined, value: unknown): Promise<Result> {
  if (validator === undefined) throw new Error("no generated validator");

  return validator["~standard"].validate(value);
}

async function accepts(validator: StandardValidator | undefined, value: unknown): Promise<boolean> {
  return !("issues" in (await validate(validator, value)));
}

async function rules(validator: StandardValidator | undefined, value: unknown): Promise<string[]> {
  const result = await validate(validator, value);

  return "issues" in result ? result.issues.map((issue) => issue.params.rule) : [];
}

// The names yup gives its own issues on a plain schema: the generated tests carry their contract rule as name.
async function yupIssueTypes(
  validator: ObjectValidator | undefined,
  value: unknown,
): Promise<string[]> {
  if (validator === undefined) throw new Error("no generated validator");

  try {
    await validator.validate(value, { abortEarly: false });

    return [];
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;

    return error.inner.map((inner) => inner.type ?? "");
  }
}

function getChannelInput(channelId: string): unknown {
  return { path: { channelId }, query: {}, headers: { authorization: "Bearer t" } };
}

function createTaskInput(body: unknown): unknown {
  return {
    path: { channelId: CHANNEL_ID },
    query: {},
    headers: { "idempotency-key": "k" },
    body,
  };
}

function createdAtValidator(): StandardValidator {
  const createdAt = outputSchemas.TaskSchema?.fields.createdAt;

  if (createdAt === undefined) throw new Error("no generated TaskSchema.createdAt validator");

  return createdAt;
}

const validTask = {
  taskId: CHANNEL_ID,
  title: "Write",
  state: "open",
  effort: 3,
  version: 1,
  createdAt: "2026-06-30T23:59:59Z",
};

describe("uuid: the 8-4-4-4-12 hex layout of ADR 0003, any version and variant digit", () => {
  test.each([
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "12345678-1234-1234-1234-123456789abc",
    "12345678-1234-0234-8234-123456789ABC",
  ])("accepts %s", async (channelId) => {
    expect(await accepts(operationInputs.GetChannelInputSchema, getChannelInput(channelId))).toBe(
      true,
    );
  });

  test.each(["12345678-1234-1234-1234-123456789ab", "1234567g-1234-1234-1234-123456789abc"])(
    "refuses %s",
    async (channelId) => {
      expect(await accepts(operationInputs.GetChannelInputSchema, getChannelInput(channelId))).toBe(
        false,
      );
    },
  );
});

describe("date-time: RFC 3339 as ADR 0003 reads it", () => {
  test.each([
    "2026-06-30T23:59:59Z",
    "2026-06-30t23:59:59z",
    "2026-06-30T23:59:59.123456789+02:00",
    "2024-02-29T00:00:00-05:30",
    "0050-01-01T00:00:00Z",
  ])("accepts %s", async (value) => {
    expect(await accepts(createdAtValidator(), value)).toBe(true);
  });

  test.each([
    "2026-06-30T23:59:59.1234567890Z",
    "2026-06-30T23:59:60Z",
    "2026-06-30T23:59:59",
    "2026-02-29T00:00:00Z",
    "2026-06-30T24:00:00Z",
    "2026-06-30T23:59:59.Z",
  ])("refuses %s", async (value) => {
    expect(await accepts(createdAtValidator(), value)).toBe(false);
  });
});

describe("query: unknown keys are refused, also on an operation without query params", () => {
  test("accepts an empty query", async () => {
    expect(await accepts(operationInputs.HealthInputSchema, { query: {} })).toBe(true);
  });

  test("refuses an unknown query key, with the key in the pointer", async () => {
    const result = await validate(operationInputs.HealthInputSchema, { query: { x: "1" } });

    expect(result).toMatchObject({
      issues: [{ path: ["query", "x"], params: { rule: "unknownKeys" } }],
    });
  });
});

describe("pattern: a sort value is one of the declared keys or its descending form", () => {
  const listTasksInput = (sort: string[]): unknown => ({
    path: { channelId: CHANNEL_ID },
    query: { sort },
    headers: { authorization: "Bearer t" },
  });

  test.each([[["createdAt"]], [["-createdAt"]]])("accepts %j", async (sort) => {
    expect(await accepts(operationInputs.ListTasksInputSchema, listTasksInput(sort))).toBe(true);
  });

  test.each([[["title"]], [["createdAt2"]], [["+createdAt"]]])("refuses %j", async (sort) => {
    expect(await rules(operationInputs.ListTasksInputSchema, listTasksInput(sort))).toEqual([
      "pattern",
    ]);
  });
});

describe("operation input: every issue names a contract rule and nothing is cast", () => {
  test("an empty title is minLength, not required", async () => {
    expect(
      await rules(operationInputs.CreateTaskInputSchema, createTaskInput({ title: "" })),
    ).toEqual(["minLength"]);
  });

  test("a missing title is required", async () => {
    expect(await rules(operationInputs.CreateTaskInputSchema, createTaskInput({}))).toEqual([
      "required",
    ]);
  });

  test("the string 5 for an integer is a type issue", async () => {
    const body = { title: "t", effort: "5" };

    expect(await rules(operationInputs.CreateTaskInputSchema, createTaskInput(body))).toEqual([
      "type",
    ]);
  });

  test("a fractional integer reports its type alone, as zod does, beside an unknown body key", async () => {
    const body = { title: "t", effort: -1.5, extra: true };

    expect(
      (await rules(operationInputs.CreateTaskInputSchema, createTaskInput(body))).sort(),
    ).toEqual(["type", "unknownKeys"]);
  });

  test("a bound and an unknown body key each name their rule", async () => {
    const body = { title: "t", effort: -1, extra: true };

    expect(
      (await rules(operationInputs.CreateTaskInputSchema, createTaskInput(body))).sort(),
    ).toEqual(["minimum", "unknownKeys"]);
  });

  test("a body that is not an object is a type issue", async () => {
    expect(await rules(operationInputs.CreateTaskInputSchema, createTaskInput("{}"))).toEqual([
      "type",
    ]);
  });

  test("a valid request passes and keeps only the declared path and header keys", async () => {
    const result = await validate(operationInputs.CreateTaskInputSchema, {
      path: { channelId: CHANNEL_ID, other: "x" },
      query: {},
      headers: { "idempotency-key": "k", cookie: "secret" },
      body: { title: "t" },
    });

    expect(result).toEqual({
      value: {
        path: { channelId: CHANNEL_ID },
        query: {},
        headers: { "idempotency-key": "k" },
        body: { title: "t" },
      },
    });
  });

  test("every issue on every golden operation carries a rule yup does not name", async () => {
    const issueRules = new Set<string>();

    for (const [name, validator] of Object.entries(operationInputs)) {
      const found = await rules(validator, { path: {}, query: { "?": 1 }, headers: {}, body: 5 });

      for (const rule of found) issueRules.add(rule);

      expect(found.length, name).toBeGreaterThan(0);
    }

    expect([...issueRules].sort()).toEqual(["required", "type", "unknownKeys"]);
  });
});

describe("path: an issue path is split exactly, also on a name with a dot", () => {
  test("a name with a dot and an array index are one segment and one index", async () => {
    const schema = standardSchemaOf(
      object({
        body: object({
          "a.b": array()
            .of(object({ "c.d": string().strict().defined() }).strict().default(undefined))
            .defined(),
        }).default(undefined),
      }),
    );
    const result = await validate(schema, { body: { "a.b": [{ "c.d": 1 }] } });

    expect(result).toMatchObject({ issues: [{ path: ["body", "a.b", "0", "c.d"] }] });
  });
});

describe("output: an undeclared key is dropped, no value is cast", () => {
  test("drops the key and keeps the declared ones", async () => {
    const result = await validate(outputSchemas.TaskSchema, { ...validTask, internal: "x" });

    expect(result).toEqual({ value: validTask });
  });

  test("refuses a string for an integer instead of converting it", async () => {
    expect(await yupIssueTypes(outputSchemas.TaskSchema, { ...validTask, version: "1" })).toEqual([
      "typeError",
    ]);
  });
});

describe("object schemas stay plain (A45)", () => {
  test("pick keeps the checks and the unknown keys test", async () => {
    const picked = inputSchemas.CreateTaskSchema?.pick(["title"]);

    expect(await yupIssueTypes(picked, { title: "" })).toEqual(["minLength"]);
    expect(await yupIssueTypes(picked, { title: "t", effort: 1 })).toEqual(["unknownKeys"]);
  });

  test("concat keeps the checks of both", async () => {
    const left = inputSchemas.CreateTaskSchema?.pick(["title"]);
    const right = inputSchemas.CreateTaskSchema?.pick(["effort"]);

    if (left === undefined || right === undefined) throw new Error("no generated schema");

    const both = left.concat(right);

    expect((await yupIssueTypes(both, { title: "", effort: -1 })).sort()).toEqual([
      "minLength",
      "minimum",
    ]);
  });
});

describe("the custom checks of the generated validators", () => {
  test("every named test carries its contract rule as its name", () => {
    const sources = ["operations/input.ts", "schemas/output.ts"].map((file) =>
      readFileSync(join(temporaryRoot, "generated-root", "generated", file), "utf8"),
    );
    const tests = sources.flatMap((source) => source.match(/\.test\(\{[\s\S]*?\n\s*\}\)/g) ?? []);

    expect(tests.length).toBeGreaterThan(0);

    for (const generatedTest of tests) expect(generatedTest).toMatch(/name: "\w+"/);
  });
});

describe("a wire name yup's issue path cannot carry is refused by name", () => {
  test("a property name with a quote", async () => {
    const ir: ContractIR = JSON.parse(readFileSync(GOLDEN_IR, "utf8"));
    const schema = ir.schemas.CreateTask;
    const property =
      schema !== undefined && isKnownVariant("Schema", schema) && schema.kind === "object"
        ? schema.properties[0]
        : undefined;

    if (property === undefined) throw new Error("the golden IR has no CreateTask property");

    property.name = 'ti"tle';

    const outcome = await target.generate({
      ir,
      options: {},
      links: {},
      artefacts: new Set(["validators"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [{ code: "wire.name.yupPath.unsupported" }],
    });
  });
});

describe("numbers: the safe integer range and finiteness the zod validators enforce", () => {
  const updateTaskInput = (expectedVersion: number): unknown => ({
    path: { channelId: CHANNEL_ID, taskId: CHANNEL_ID },
    query: {},
    headers: { authorization: "Bearer t", "if-match": "1", "idempotency-key": "k" },
    body: { expectedVersion },
  });

  test.each([2 ** 53, 2 ** 60])("an integer of %d is a maximum issue", async (expectedVersion) => {
    expect(
      await rules(operationInputs.UpdateTaskInputSchema, updateTaskInput(expectedVersion)),
    ).toContain("maximum");
  });

  test("an integer below the safe range is a minimum issue", async () => {
    expect(
      await rules(operationInputs.UpdateTaskInputSchema, updateTaskInput(-(2 ** 60))),
    ).toContain("minimum");
  });

  test("a number that is Infinity, as JSON 1e999 reads, is a type issue", async () => {
    const ir = goldenIr();
    const schema = ir.schemas.CreateTask;
    const effort =
      schema !== undefined && isKnownVariant("Schema", schema) && schema.kind === "object"
        ? schema.properties.find((property) => property.name === "effort")
        : undefined;

    if (effort === undefined || effort.type.kind !== "scalar") {
      throw new Error("the golden IR has no scalar CreateTask effort");
    }

    effort.type = { kind: "scalar", type: "number", refinements: {} };

    const generated = await generateAndImport(ir, "number-root");
    const body = JSON.parse('{ "title": "t", "effort": 1e999 }');

    expect(
      await rules(generated.operationInputs.CreateTaskInputSchema, createTaskInput(body)),
    ).toEqual(["type"]);
  });
});

describe("an output enum is any string: null is a type issue, as on zod", () => {
  test("a null task state", async () => {
    expect(await rules(standardSchemaOf(outputSchemas.TaskSchema?.fields.state), null)).toEqual([
      "type",
    ]);
  });
});

describe("describe reports the same refusals as generate", () => {
  test("a wire name yup's issue path cannot carry", () => {
    const ir = goldenIr();
    const schema = ir.schemas.CreateTask;
    const property =
      schema !== undefined && isKnownVariant("Schema", schema) && schema.kind === "object"
        ? schema.properties[0]
        : undefined;

    if (property === undefined) throw new Error("the golden IR has no CreateTask property");

    property.name = 'ti"tle';

    expect(target.describe(ir, {})).toMatchObject({
      status: "refused",
      refusals: [{ code: "wire.name.yupPath.unsupported" }],
    });
  });
});

describe("a required opaque member: absent is refused, null is valid", () => {
  const paymentEvent = (members: object): unknown => ({ id: CHANNEL_ID, type: "paid", ...members });

  test("a missing data member is required", async () => {
    const validator = standardSchemaOf(inputSchemas.PaymentEventSchema);
    const found = await rules(validator, paymentEvent({}));

    expect(found).toContain("required");
  });

  test("a null data member is accepted", async () => {
    const validator = standardSchemaOf(inputSchemas.PaymentEventSchema);

    expect(await rules(validator, paymentEvent({ data: null }))).not.toContain("required");
  });
});

describe("the multiple-of check of the support module", () => {
  test.each([
    [3, 0.1, true],
    [0.07, 0.01, true],
    [0.075, 0.01, false],
    [0.3, 0.1, true],
    [10, 5, true],
    [7, 5, false],
    [-9, 3, true],
  ])("%s is a multiple of %s: %s", (value, step, expected) => {
    expect(isMultipleOf(value, step)).toBe(expected);
  });
});
