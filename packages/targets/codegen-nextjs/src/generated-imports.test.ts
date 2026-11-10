import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDirectory } from "@seampact/codegen-core/node-server/test-support";
import { expect, test } from "vitest";
import { nextGenerateRequest } from "./generate-request.test-support.js";
import { target } from "./index.js";

const RELATIVE_SPECIFIER = /from "(\.{1,2}\/[^"]*)"/g;
const PROJECT = projectDirectory(import.meta.url, "next-generated-imports");
// The types and validators files the reference project writes beside the Next.js entry, with its import style.
const PROVIDER_DIRECTORIES = ["generated/types", "generated/validators"];

function relativeSpecifiersOf(contents: readonly string[]): string[] {
  return contents.flatMap((text) =>
    [...text.matchAll(RELATIVE_SPECIFIER)].map((match) => match[1] ?? ""),
  );
}

function providerFileContents(): string[] {
  return PROVIDER_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(PROJECT, directory), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(PROJECT, directory, file), "utf8")),
  );
}

test("every relative import of the generated tree is extensionless, as Turbopack resolves it", async () => {
  const outcome = await target.generate(await nextGenerateRequest(PROJECT));

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome));

  const specifiers = relativeSpecifiersOf(outcome.files.map((file) => file.contents));

  expect(specifiers).toContain("./routes");
  expect(specifiers.filter((specifier) => specifier.endsWith(".js"))).toEqual([]);
});

test("every relative import of the linked types and validators files is extensionless too", async () => {
  await nextGenerateRequest(PROJECT);

  const specifiers = relativeSpecifiersOf(providerFileContents());

  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.filter((specifier) => specifier.endsWith(".js"))).toEqual([]);
});
