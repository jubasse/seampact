import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { generateIrTypes } from "./generate-types.js";
import { formatTypeScript } from "./test-support.js";

const TYPES_PATH = fileURLToPath(new URL("./types.generated.ts", import.meta.url));

test("types match schema", () => {
  const generated = formatTypeScript(generateIrTypes(), TYPES_PATH);
  if (process.env.UPDATE_IR_TYPES === "1") writeFileSync(TYPES_PATH, generated);
  expect(readFileSync(TYPES_PATH, "utf8"), "run UPDATE_IR_TYPES=1 to regenerate").toBe(generated);
});
