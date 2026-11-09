import type { FrameworkRouteCheck, GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { nextGenerateRequest, REFERENCE_API } from "./generate-request.test-support.js";
import { target } from "./index.js";

async function refusalCodes(overrides: Partial<GenerateRequest>): Promise<string[]> {
  const outcome = await target.generate(await nextGenerateRequest(overrides));

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

function withoutPrefixes(ir: ContractIR): ContractIR {
  const surfaces = Object.fromEntries(
    Object.entries(ir.api.surfaces).map(([name, surface]) => [name, { ...surface, prefix: "" }]),
  );

  return { ...ir, api: { ...ir.api, surfaces } };
}

describe("what a Next.js entry asks and the target refuses by name", () => {
  test("the reference entry is generated", async () => {
    expect(await refusalCodes({})).toEqual([]);
  });

  test("a frameworkRoutes allow-list, since no check reads a Next.js app's routes", async () => {
    const frameworkRoutes: FrameworkRouteCheck = {
      status: "on",
      allowed: [{ path: "/v1/health", reason: "the app's probe" }],
      scope: "contract",
    };

    expect(await refusalCodes({ frameworkRoutes })).toEqual(["frameworkRoutes.unsupported"]);
  });

  test("an explicit artefacts.bootCheck.frameworkRoutes other than false", async () => {
    const frameworkRoutes: FrameworkRouteCheck = {
      status: "on",
      allowed: [],
      scope: "strict",
      written: true,
    };

    expect(await refusalCodes({ frameworkRoutes })).toEqual([
      "artefacts.bootCheck.frameworkRoutes.unsupported",
    ]);
    expect(await refusalCodes({ frameworkRoutes: { status: "off" } })).toEqual([]);
  });

  test("an api whose mounted base path is empty", async () => {
    const ir = withoutPrefixes(readGoldenIr(REFERENCE_API));

    expect(await refusalCodes({ ir })).toEqual(["path.base.empty.unsupported"]);
    expect(await refusalCodes({ ir, mount: "/api" })).toEqual([]);
  });

  test("catchAll: false, since the catch-all route file is the api's only route", async () => {
    expect(await refusalCodes({ options: { catchAll: false } })).toEqual([
      "options.catchAll.unsupported",
    ]);
  });
});
