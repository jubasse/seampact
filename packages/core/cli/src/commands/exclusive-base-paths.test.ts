import { defineTarget, parseNoOptions } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { TargetEntry } from "@seampact/spec/config";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { PlannedEntry } from "./entry-links.js";
import { exclusiveBasePathProblems } from "./exclusive-base-paths.js";

const EXCLUSIVE = "exclusive";
const SHARED = "shared";

type BasePathRouting = typeof EXCLUSIVE | typeof SHARED;

interface ServedApiOf {
  readonly api: string;
  readonly prefixes: readonly string[];
}

// The golden tasks IR with one surface per given prefix.
function apiServedUnder({ api, prefixes }: ServedApiOf): PlannedEntry["apis"][number] {
  const ir = readGoldenIr("tasks");
  const [template] = Object.values(ir.api.surfaces);

  if (template === undefined) throw new Error("the golden tasks IR has no surface");

  const surfaces = Object.fromEntries(
    prefixes.map((prefix, index) => [`surface${index}`, { ...template, prefix }]),
  );

  return { api, source: `${api}.yaml`, ir: { ...ir, api: { ...ir.api, surfaces } }, root: api };
}

function plannedEntry(
  entry: Pick<TargetEntry, "id" | "mount">,
  routing: BasePathRouting,
  apis: readonly ServedApiOf[],
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
      ...(routing === EXCLUSIVE ? { exclusiveBasePaths: true } : {}),
    },
    format: async (source) => source,
    parseOptions: parseNoOptions,
    generate: () => ({ status: "generated", files: [] }),
  });

  return {
    entry: { use: "@acme/target", out: entry.id, ...entry },
    target,
    apis: apis.map(apiServedUnder),
  };
}

describe("the base paths of apis routed before the boundary", () => {
  test("apis under distinct base paths pass, and one api's own nested surfaces too", () => {
    const outcome = exclusiveBasePathProblems([
      plannedEntry({ id: "next" }, EXCLUSIVE, [
        { api: "tasks", prefixes: ["/v1", "/v1/hooks"] },
        { api: "billing", prefixes: ["/v1-billing"] },
      ]),
    ]);

    expect(outcome).toEqual({ status: "done", value: undefined });
  });

  test("two apis under nested base paths are refused by name, across entries and mounts", () => {
    const outcome = exclusiveBasePathProblems([
      plannedEntry({ id: "next" }, EXCLUSIVE, [{ api: "tasks", prefixes: ["/api/v1"] }]),
      plannedEntry({ id: "admin", mount: "/api" }, EXCLUSIVE, [{ api: "billing", prefixes: [""] }]),
    ]);

    expect(outcome).toMatchObject({
      status: "refused",
      problems: [
        {
          code: "path.base.shared.unsupported",
          message: expect.stringContaining("'/api/v1'"),
          where: "entry 'admin', api 'billing'",
        },
      ],
    });
  });

  test("two apis under equal base paths are refused", () => {
    const outcome = exclusiveBasePathProblems([
      plannedEntry({ id: "next" }, EXCLUSIVE, [
        { api: "tasks", prefixes: ["/v1"] },
        { api: "billing", prefixes: ["/v1"] },
      ]),
    ]);

    expect(outcome).toMatchObject({
      status: "refused",
      problems: [{ code: "path.base.shared.unsupported" }],
    });
  });

  test("a target that does not route by base path is not checked", () => {
    const outcome = exclusiveBasePathProblems([
      plannedEntry({ id: "hono" }, SHARED, [
        { api: "tasks", prefixes: ["/v1"] },
        { api: "billing", prefixes: ["/v1"] },
      ]),
    ]);

    expect(outcome).toEqual({ status: "done", value: undefined });
  });
});
