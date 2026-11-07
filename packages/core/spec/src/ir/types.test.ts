import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { generateIrTypes, type IrTypesMode } from "./generate-types.js";
import { IR_SCHEMA_DOCUMENTS } from "./schemas.js";
import { formatTypeScript } from "./test-support.js";
import type { ContractIR, SourceMap } from "./types.generated.js";
import type * as IrWriter from "./types.writer.generated.js";

// The open reader types and the closed writer view (ADR 0004 section 13), both generated from the schema files.
const FILES: readonly { mode: IrTypesMode; file: string }[] = [
  { mode: "open", file: "./types.generated.ts" },
  { mode: "closed", file: "./types.writer.generated.ts" },
];

for (const { mode, file } of FILES) {
  test(`types match schema (${mode})`, () => {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const generated = formatTypeScript(generateIrTypes(IR_SCHEMA_DOCUMENTS, mode), path);

    if (process.env.UPDATE_IR_TYPES === "1") writeFileSync(path, generated);
    expect(readFileSync(path, "utf8"), "run UPDATE_IR_TYPES=1 to regenerate").toBe(generated);
  });
}

test("the writer view has no unknown arm and no open string", () => {
  const writer = generateIrTypes(IR_SCHEMA_DOCUMENTS, "closed");

  expect(writer).not.toContain("UnknownVariant");
  expect(writer).not.toContain("string & {}");
});

test("a written IR is an IR: each writer type is assignable to its open type", () => {
  const assignable: [
    IrWriter.ContractIR extends ContractIR ? true : false,
    IrWriter.SourceMap extends SourceMap ? true : false,
  ] = [true, true];

  expect(assignable).toEqual([true, true]);
});
