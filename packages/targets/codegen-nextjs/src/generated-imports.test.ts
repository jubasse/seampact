import { expect, test } from "vitest";
import { nextGenerateRequest } from "./generate-request.test-support.js";
import { target } from "./index.js";

const RELATIVE_SPECIFIER = /from "(\.{1,2}\/[^"]*)"/g;

test("every relative import of the generated tree is extensionless, as Turbopack resolves it", async () => {
  const outcome = await target.generate(await nextGenerateRequest());

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome));

  const specifiers = outcome.files.flatMap((file) =>
    [...file.contents.matchAll(RELATIVE_SPECIFIER)].map((match) => match[1]),
  );

  expect(specifiers).toContain("./routes");
  expect(specifiers.filter((specifier) => specifier?.endsWith(".js"))).toEqual([]);
});
