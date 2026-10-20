import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { describe, expect, test } from "vitest";
import { target } from "./index.js";

// express has no OpenAPI generator of its own (ADR 0009 "Artefacts and the compatibility matrix"), so it declares no
// `nativeDocs` artefact and the app writes seampact's document with `openapi`.

describe("the express target and nativeDocs", () => {
  test("nativeDocs is not declared", async () => {
    expect(target.metadata.artefacts.map((artefact) => artefact.id)).not.toContain("nativeDocs");

    const outcome = await target.generate({
      ir: readGoldenIr("tasks"),
      options: {},
      links: {},
      artefacts: new Set(["boundary", "nativeDocs"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({
          code: "artefact.unknown",
          message: expect.stringContaining("'nativeDocs'"),
        }),
      ]),
    });
  });

  test("frameworkDocs off has a fix that says the framework writes no document", () => {
    expect(target.metadata.frameworkDocsOffFix).toBe(
      "this framework writes no document of its own; remove the key",
    );
  });
});
