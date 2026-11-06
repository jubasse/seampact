import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

// The types every Node server and the fetch client link refuse these forms by name, so no target of the family
// serves them in 1.0.

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

function readGolden(path: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/${path}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

async function refusalsOf(ir: ContractIR): Promise<{ code: string; member?: string }[]> {
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["types"]),
  });

  return outcome.status === "refused"
    ? outcome.refusals.map(({ code, member }) => ({
        code,
        ...(member === undefined ? {} : { member }),
      }))
    : [];
}

test("a tagged union is refused by name", async () => {
  const codes = (await refusalsOf(readGolden("extensions/studio"))).map(({ code }) => code);

  expect(codes).toContain("schema.union.unsupported");
});

test("a redirect response is refused by name", async () => {
  // The 303 of the second operation, so another refused form of the fixture cannot stand in for the redirect.
  expect(await refusalsOf(readGolden("bodies/notes"))).toContainEqual({
    code: "response.shape.unsupported",
    member: "/operations/1/responses/0/shape",
  });
});
