import { defineTarget, type ImportSpecifierStyle, parseNoOptions } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import type { TargetEntry } from "@seampact/spec/config";
import { describe, expect, test } from "vitest";
import type { PlannedEntry } from "./entry-links.js";
import { importSpecifierStyles } from "./import-specifier-styles.js";

function plannedEntry(
  entry: Pick<TargetEntry, "id" | "link">,
  importSpecifiers?: ImportSpecifierStyle,
): PlannedEntry {
  const target = defineTarget({
    metadata: {
      packageName: "@acme/target",
      packageVersion: "1.0.0",
      role: "server",
      irSupport: { irVersions: [IR_VERSION], irRevision: IR_REVISION, kinds: [], features: [] },
      artefacts: [],
      consumes: {},
      provides: {},
      ...(importSpecifiers === undefined ? {} : { importSpecifiers }),
    },
    format: async (source) => source,
    parseOptions: parseNoOptions,
    generate: () => ({ status: "generated", files: [] }),
  });

  return { entry: { use: "@acme/target", out: entry.id, ...entry }, target, apis: [] };
}

describe("the import specifier style of each entry", () => {
  test("a provider takes the style of its consumers", () => {
    const outcome = importSpecifierStyles([
      plannedEntry({ id: "types" }),
      plannedEntry({ id: "validators" }),
      plannedEntry(
        { id: "server", link: { types: "types", validators: "validators" } },
        "extensionless",
      ),
    ]);

    expect(outcome).toEqual({
      status: "done",
      value: new Map([
        ["server", "extensionless"],
        ["types", "extensionless"],
        ["validators", "extensionless"],
      ]),
    });
  });

  test("a provider linked from two styles is refused by name", () => {
    const outcome = importSpecifierStyles([
      plannedEntry({ id: "types" }),
      plannedEntry({ id: "next", link: { types: "types" } }, "extensionless"),
      plannedEntry({ id: "hono", link: { types: "types" } }),
    ]);

    expect(outcome).toMatchObject({
      status: "refused",
      problems: [{ code: "link.importSpecifiers.mixed", where: "entry 'types'" }],
    });
  });
});
