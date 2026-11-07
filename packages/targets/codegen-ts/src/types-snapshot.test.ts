import { expect, test } from "vitest";
import { readGoldenIr } from "./generated-project.test-support.js";
import { target } from "./index.js";

// Every generated file of the reference contract, kept as a reviewed snapshot that the user docs excerpt.
test("the types of the reference contract match their snapshot", async () => {
  const outcome = await target.generate({
    ir: readGoldenIr("tasks"),
    options: {},
    links: {},
    artefacts: new Set(["types"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  for (const file of outcome.files) {
    await expect(file.contents).toMatchFileSnapshot(`../types-snapshots/${file.path}.snap`);
  }
});
