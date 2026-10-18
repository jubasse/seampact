import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readAppConfig } from "./read-app-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function readConfigText(text: string) {
  const directory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(directory);

  const file = join(directory, "seampact.config.yaml");

  writeFileSync(file, text);

  return readAppConfig(file, "seampact.config.yaml");
}

test("refuses a reserved key written directly or as a YAML alias", async () => {
  const direct = await readConfigText(
    "sources:\n  contracts: { path: ./c }\ntargets:\n  - { id: t, use: x, api: a, options: { __proto__: { polluted: true } } }\n",
  );
  const aliased = await readConfigText(
    "sources:\n  contracts: { path: ./c }\ntargets:\n  - id: t\n    use: x\n    api: a\n    options: { name: &k __proto__, ? *k : { polluted: true } }\n",
  );

  for (const outcome of [direct, aliased]) {
    expect(outcome).toMatchObject({
      status: "refused",
      problems: [{ code: "config.key.reserved", message: expect.stringContaining("'__proto__'") }],
    });
  }
});
