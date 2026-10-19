import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedFiles } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IR = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const RUNTIME_PACKAGES = ["class-validator", "class-transformer", "reflect-metadata"];
const CHANNEL_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TASK_ID = "12345678-1234-1234-1234-123456789abc";

interface StandardSchema {
  "~standard": {
    validate(value: unknown): Promise<{ value?: unknown; issues?: readonly Issue[] }>;
  };
}

interface Issue {
  message: string;
  path: readonly PropertyKey[];
  params: { rule: string };
}

type DtoClass = new () => object;

interface Adapter {
  dtoSchema(dto: DtoClass, direction: "input" | "output"): StandardSchema;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-class-validator-run-"));

let operationInputs: Record<string, StandardSchema>;
let outputSchemas: Record<string, StandardSchema>;
let inputDtos: Record<string, DtoClass>;
let adapter: Adapter;

// Generates the reference validators into a project that resolves the libraries to this package's copies and
// compiles legacy decorators, then imports them after `reflect-metadata`, as a NestJS app does.
beforeAll(async () => {
  const ir: ContractIR = JSON.parse(readFileSync(GOLDEN_IR, "utf8"));
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["validators"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const outDir = join(temporaryRoot, "generated");
  const written = await writeGeneratedFiles(
    outDir,
    "@seampact/codegen-class-validator",
    outcome.files,
  );

  if (written.status !== "written") throw new Error(JSON.stringify(written.refusals));

  mkdirSync(join(temporaryRoot, "node_modules"));

  for (const name of RUNTIME_PACKAGES) {
    const packageDirectory = new URL(`../node_modules/${name}`, import.meta.url).pathname;

    symlinkSync(packageDirectory, join(temporaryRoot, "node_modules", name), "dir");
  }

  writeFileSync(join(temporaryRoot, "package.json"), '{ "type": "module" }\n');
  writeFileSync(
    join(temporaryRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2024", experimentalDecorators: true } }),
  );

  await import(join(temporaryRoot, "node_modules", "reflect-metadata", "Reflect.js"));
  operationInputs = await import(join(outDir, "operations/input.ts"));
  outputSchemas = await import(join(outDir, "schemas/output.ts"));
  inputDtos = await import(join(outDir, "dtos/input.ts"));
  adapter = await import(join(outDir, "class-validator-schema.ts"));
});

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function exported<Value>(module: Record<string, Value>, name: string): Value {
  const value = module[name];

  if (value === undefined) throw new Error(`no generated export ${name}`);

  return value;
}

// The issues as `<pointer> <rule>` lines, or `valid`.
async function verdict(schema: StandardSchema, value: unknown): Promise<string[] | "valid"> {
  const result = await schema["~standard"].validate(value);

  if (result.issues === undefined) return "valid";

  return result.issues.map((issue) => `/${issue.path.map(String).join("/")} ${issue.params.rule}`);
}

function inputVerdict(operationExport: string, value: unknown): Promise<string[] | "valid"> {
  return verdict(exported(operationInputs, operationExport), value);
}

function createTask(body: unknown, headers: Record<string, string> = {}): unknown {
  return {
    path: { channelId: CHANNEL_ID },
    query: {},
    headers: { "idempotency-key": "k1", ...headers },
    body,
  };
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: TASK_ID,
    title: "Write",
    state: "open",
    version: 1,
    createdAt: "2026-06-30T23:59:59Z",
    ...overrides,
  };
}

describe("unknown keys: refused in the body and the query, undeclared headers dropped", () => {
  test("an unknown body key", async () => {
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "a", extra: 1 })),
    ).toEqual(["/body/extra unknownKeys"]);
  });

  test("an unknown query key, also on an operation without query params", async () => {
    expect(
      await inputVerdict("HealthInputSchema", { path: {}, query: { x: "1" }, headers: {} }),
    ).toEqual(["/query/x unknownKeys"]);
  });

  test("an undeclared header passes and is not handed on", async () => {
    const result = await exported(operationInputs, "CreateTaskInputSchema")["~standard"].validate(
      createTask({ title: "a" }, { "x-other": "1" }),
    );

    expect(result.issues).toBeUndefined();
    expect(result.value).toMatchObject({ headers: { "idempotency-key": "k1" } });
    expect(result.value).not.toHaveProperty(["headers", "x-other"]);
  });

  test("a __proto__ body key is an unknown key and leaves Object.prototype untouched", async () => {
    const body = JSON.parse('{ "title": "a", "__proto__": { "polluted": true } }');

    expect(await inputVerdict("CreateTaskInputSchema", createTask(body))).toEqual([
      "/body/__proto__ unknownKeys",
    ]);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
  });

  test("a constructor body key is an unknown key", async () => {
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "a", constructor: 1 })),
    ).toEqual(["/body/constructor unknownKeys"]);
  });

  test("an opaque member keeps any key", async () => {
    const payment = { id: "evt", type: "paid", data: { constructor: 1, nested: { toString: 2 } } };

    expect(
      await inputVerdict("PaymentsInputSchema", {
        path: {},
        query: {},
        headers: { "stripe-signature": "s" },
        body: payment,
      }),
    ).toBe("valid");
  });
});

describe("types and presence: no conversion, null is no absence", () => {
  test('"5" for an integer is a type issue', async () => {
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "a", effort: "5" })),
    ).toEqual(["/body/effort type"]);
  });

  test("null for an optional property is refused", async () => {
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "a", effort: null })),
    ).toEqual(["/body/effort type"]);
  });

  test("a missing title is required, reported alone", async () => {
    expect(await inputVerdict("CreateTaskInputSchema", createTask({}))).toEqual([
      "/body/title required",
    ]);
  });

  test("a missing body is required", async () => {
    expect(await inputVerdict("CreateTaskInputSchema", createTask(undefined))).toEqual([
      "/body required",
    ]);
  });

  test("a body that is a list is a type issue, reported alone", async () => {
    expect(await inputVerdict("CreateTaskInputSchema", createTask([{ title: "a" }]))).toEqual([
      "/body type",
    ]);
  });
});

describe("lengths count code points", () => {
  test("an empty title gives minLength", async () => {
    expect(await inputVerdict("CreateTaskInputSchema", createTask({ title: "" }))).toEqual([
      "/body/title minLength",
    ]);
  });

  test("200 emoji fit a 200-character title, 201 do not", async () => {
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "😀".repeat(200) })),
    ).toBe("valid");
    expect(
      await inputVerdict("CreateTaskInputSchema", createTask({ title: "😀".repeat(201) })),
    ).toEqual(["/body/title maxLength"]);
  });
});

describe("list items are reported at their index", () => {
  test("a malformed id in a batch", async () => {
    expect(
      await inputVerdict("GetTasksBatchInputSchema", {
        path: { channelId: CHANNEL_ID },
        query: {},
        headers: {},
        body: { ids: [TASK_ID, "nope", 3] },
      }),
    ).toEqual(["/body/ids/1 format", "/body/ids/2 type"]);
  });

  test("a sort value off the declared keys", async () => {
    expect(
      await inputVerdict("ListTasksInputSchema", {
        path: { channelId: CHANNEL_ID },
        query: { sort: ["createdAt", "title"] },
        headers: {},
      }),
    ).toEqual(["/query/sort/1 pattern"]);
  });

  test("an item that is not an object, once", async () => {
    expect(
      await verdict(exported(outputSchemas, "TaskSearchResultSchema"), { items: [task(), "x"] }),
    ).toEqual(["/items/1 type"]);
  });
});

describe("uuid: the 8-4-4-4-12 hex layout of ADR 0003, any version and variant digit", () => {
  const getChannel = (channelId: string): unknown => ({
    path: { channelId },
    query: {},
    headers: {},
  });

  test.each([CHANNEL_ID, TASK_ID, "12345678-1234-0234-8234-123456789ABC"])(
    "accepts %s",
    async (channelId) => {
      expect(await inputVerdict("GetChannelInputSchema", getChannel(channelId))).toBe("valid");
    },
  );

  test.each(["12345678-1234-1234-1234-123456789ab", "1234567g-1234-1234-1234-123456789abc"])(
    "refuses %s",
    async (channelId) => {
      expect(await inputVerdict("GetChannelInputSchema", getChannel(channelId))).toEqual([
        "/path/channelId format",
      ]);
    },
  );
});

describe("date-time: RFC 3339 as ADR 0003 reads it", () => {
  const taskSchema = (): StandardSchema => exported(outputSchemas, "TaskSchema");

  test.each([
    "2026-06-30T23:59:59Z",
    "2026-06-30t23:59:59z",
    "2026-06-30T23:59:59.123456789+02:00",
    "2024-02-29T00:00:00-05:30",
    "0050-01-01T00:00:00Z",
  ])("accepts %s", async (createdAt) => {
    expect(await verdict(taskSchema(), task({ createdAt }))).toBe("valid");
  });

  test.each([
    "2026-06-30T23:59:59.1234567890Z",
    "2026-06-30T23:59:60Z",
    "2026-06-30T23:59:59",
    "2026-02-29T00:00:00Z",
    "2026-06-30T24:00:00Z",
  ])("refuses %s", async (createdAt) => {
    expect(await verdict(taskSchema(), task({ createdAt }))).toEqual(["/createdAt format"]);
  });
});

describe("output: undeclared keys are stripped, at every depth", () => {
  test("a task and a search result item lose their extra keys", async () => {
    const result = await exported(outputSchemas, "TaskSearchResultSchema")["~standard"].validate({
      items: [task({ secret: "s" })],
      total: 1,
      extra: true,
    });

    expect(result).toEqual({ value: { items: [task()], total: 1 } });
  });
});

describe("a subclass of a DTO keeps its checks (A45)", () => {
  test("an empty title on a subclass of CreateTaskDto", async () => {
    class AppCreateTask extends exported(inputDtos, "CreateTaskDto") {}

    expect(await verdict(adapter.dtoSchema(AppCreateTask, "input"), { title: "" })).toEqual([
      "/title minLength",
    ]);
  });
});
