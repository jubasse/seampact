import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedFiles } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IR = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const ZOD_PACKAGE = new URL("../node_modules/zod", import.meta.url).pathname;

interface SafeParser {
  safeParse(value: unknown): { success: boolean };
}

interface ObjectValidator extends SafeParser {
  shape: Record<string, SafeParser>;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-zod-run-"));

let operationInputs: Record<string, SafeParser>;
let outputSchemas: Record<string, ObjectValidator>;

// Generates the reference validators into a project that resolves `zod` to this package's copy, then imports them.
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
  const written = await writeGeneratedFiles(outDir, "@seampact/codegen-zod", outcome.files);

  if (written.status !== "written") throw new Error(JSON.stringify(written.refusals));

  mkdirSync(join(temporaryRoot, "node_modules"));
  symlinkSync(ZOD_PACKAGE, join(temporaryRoot, "node_modules", "zod"), "dir");
  writeFileSync(join(temporaryRoot, "package.json"), '{ "type": "module" }\n');

  operationInputs = await import(join(outDir, "operations/input.ts"));
  outputSchemas = await import(join(outDir, "schemas/output.ts"));
});

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function getChannelInput(channelId: string): unknown {
  return { path: { channelId }, query: {}, headers: {} };
}

function inputValidator(exportName: string): SafeParser {
  const validator = operationInputs[exportName];

  if (validator === undefined) throw new Error(`no generated validator ${exportName}`);

  return validator;
}

function createdAtValidator(): SafeParser {
  const createdAt = outputSchemas.TaskSchema?.shape.createdAt;

  if (createdAt === undefined) throw new Error("no generated TaskSchema.createdAt validator");

  return createdAt;
}

describe("uuid: the 8-4-4-4-12 hex layout of ADR 0003, any version and variant digit", () => {
  test.each([
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "12345678-1234-1234-1234-123456789abc",
    "12345678-1234-0234-8234-123456789ABC",
  ])("accepts %s", (channelId) => {
    expect(
      inputValidator("GetChannelInputSchema").safeParse(getChannelInput(channelId)).success,
    ).toBe(true);
  });

  test.each(["12345678-1234-1234-1234-123456789ab", "1234567g-1234-1234-1234-123456789abc"])(
    "refuses %s",
    (channelId) => {
      expect(
        inputValidator("GetChannelInputSchema").safeParse(getChannelInput(channelId)).success,
      ).toBe(false);
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
  ])("accepts %s", (value) => {
    expect(createdAtValidator().safeParse(value).success).toBe(true);
  });

  test.each([
    "2026-06-30T23:59:59.1234567890Z",
    "2026-06-30T23:59:60Z",
    "2026-06-30T23:59:59",
    "2026-02-29T00:00:00Z",
    "2026-06-30T24:00:00Z",
    "2026-06-30T23:59:59.Z",
  ])("refuses %s", (value) => {
    expect(createdAtValidator().safeParse(value).success).toBe(false);
  });
});

describe("query: unknown keys are refused, also on an operation without query params", () => {
  test("accepts an empty query", () => {
    expect(inputValidator("HealthInputSchema").safeParse({ query: {} }).success).toBe(true);
  });

  test("refuses an unknown query key", () => {
    expect(inputValidator("HealthInputSchema").safeParse({ query: { x: "1" } }).success).toBe(
      false,
    );
  });
});
