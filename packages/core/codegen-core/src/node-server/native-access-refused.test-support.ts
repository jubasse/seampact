import { expect, test } from "vitest";
import type { Target } from "../target.js";
import { readGoldenIr } from "./reference-project.test-support.js";

// Native access (`artefacts.accessHooks: false`) waits for a consumer on the Node servers: no Node server declares the
// `accessHooks` artefact, so the app config's switch is refused by name as an artefact the target does not declare
// (`config.artefacts.unknown`), and the boundary always generates the access hooks.

const ACCESS_HOOKS_ARTEFACT = "accessHooks";

/** Registers the refusal test of native access for one Node server target. */
export function describeNativeAccessRefusal(target: Target): void {
  test("native access is refused by name", async () => {
    expect(target.metadata.artefacts.map((artefact) => artefact.id)).not.toContain(
      ACCESS_HOOKS_ARTEFACT,
    );

    const outcome = await target.generate({
      ir: readGoldenIr("tasks"),
      options: {},
      links: {},
      artefacts: new Set(["boundary", "index", ACCESS_HOOKS_ARTEFACT]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({
          code: "artefact.unknown",
          message: expect.stringContaining(`'${ACCESS_HOOKS_ARTEFACT}'`),
        }),
      ]),
    });
  });
}
