import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { readAppConfig } from "./read-app-config.js";
import { isNativeTargetUse } from "./resolve-target.js";

// The shared `use` vectors (`packages/core/spec/vectors/config/use-forms.json`), which the JVM and PHP readers
// prove themselves on too.
interface UseFormVectors {
  accepted: { use: string; ecosystem: string }[];
  refused: { use: string; case: string }[];
}

const VECTORS: UseFormVectors = JSON.parse(
  readFileSync(new URL("../../../spec/vectors/config/use-forms.json", import.meta.url), "utf8"),
);

const NPM_ECOSYSTEM = "npm";

async function readEntryWithUse(use: string) {
  const directory = writeConfigTree({
    "seampact.config.yaml": `targets:\n  - { id: server, use: '${use}', api: a }\n`,
  });

  try {
    return await readAppConfig(`${directory}/seampact.config.yaml`, "seampact.config.yaml");
  } finally {
    removeConfigTrees();
  }
}

describe("the use forms of a target entry", () => {
  test.each(VECTORS.accepted)("reads '$use' as a $ecosystem target", async ({ use, ecosystem }) => {
    expect(await readEntryWithUse(use)).toMatchObject({ status: "read" });
    expect(isNativeTargetUse(use)).toBe(ecosystem !== NPM_ECOSYSTEM);
  });

  test.each(VECTORS.refused)("refuses '$use', $case", async ({ use }) => {
    expect(await readEntryWithUse(use)).toMatchObject({
      status: "refused",
      problems: [
        {
          code: "config.schema",
          message: expect.stringContaining("'pypi:' then its PEP 503 normalised name"),
          where: expect.stringContaining(":2:19 targets[0].use"),
        },
      ],
    });
  });
});
