import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Refusal } from "@seampact/codegen-core";
import type { OwnValidators } from "@seampact/codegen-core/node-server";
import { projectDirectory, readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { RULES_MODES, type RulesMode } from "@seampact/codegen-core/validators";
import { describe, expect, test } from "vitest";
import { vineOwnValidators } from "./vinejs/index.js";

// A UUID whose version digit is 9: the contract's 8-4-4-4-12 layout holds, VineJS's version check refuses it.
const VERSION_NINE_UUID = "00000000-0000-9000-8000-000000000000";

function ownValidatorsOf(rules: RulesMode): OwnValidators {
  const refusals: Refusal[] = [];
  const written = vineOwnValidators(readGoldenIr("tasks"), refusals, { rules });

  if (written === undefined) throw new Error(JSON.stringify(refusals));

  return written;
}

// Every VineJS validator file of each rules mode, kept as a reviewed snapshot: the validators of
// `seampact-consistent` are the output from before the option existed.
test.each(RULES_MODES)(
  "the %s VineJS validators of the reference contract match their snapshot",
  async (rules) => {
    for (const file of ownValidatorsOf(rules).files) {
      await expect(file.contents).toMatchFileSnapshot(
        `../rules-snapshots/${rules}/${file.path}.snap`,
      );
    }
  },
);

describe("VineJS's own rules differ from the contract where the validator page says", () => {
  async function inputSchemasOf(rules: RulesMode) {
    const project = projectDirectory(import.meta.url, `rules-${rules}`);

    for (const file of ownValidatorsOf(rules).files) {
      const path = join(project, file.path);

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.contents);
    }

    return import(join(project, "schemas/input.ts"));
  }

  async function issueRules(rules: RulesMode, schemaName: string, value: unknown) {
    const schemas = await inputSchemasOf(rules);
    const result = await schemas[schemaName]["~standard"].validate(value);

    return (result.issues ?? []).map((issue: { params?: { rule: string } }) => issue.params?.rule);
  }

  test("native counts a length in UTF-16 units, the contract in code points", async () => {
    const title = "\u{1F600}".repeat(150);

    expect(await issueRules("native", "CreateTaskSchema", { title })).toEqual(["maxLength"]);
    expect(await issueRules("seampact-consistent", "CreateTaskSchema", { title })).toEqual([]);
  });

  test("native checks a UUID's version digit, the contract its layout only", async () => {
    const value = { userId: VERSION_NINE_UUID };

    expect(await issueRules("native", "AssignTaskInputSchema", value)).toEqual(["format"]);
    expect(await issueRules("seampact-consistent", "AssignTaskInputSchema", value)).toEqual([]);
  });

  test("a native rule reads with the plan's message and rule name", async () => {
    const schemas = await inputSchemasOf("native");
    const result = await schemas.CreateTaskSchema["~standard"].validate({ title: "" });

    expect(result.issues).toEqual([
      expect.objectContaining({
        message: "Expected at least 1 character.",
        params: { rule: "minLength" },
      }),
    ]);
  });
});
