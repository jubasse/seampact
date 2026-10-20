import type { ArtefactDeclaration } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import type { ArtefactSwitches } from "@seampact/spec/config";
import { expect, test } from "vitest";
import { selectArtefacts } from "./artefact-switches.js";
import { stubTarget } from "./target-stub.test-support.js";

// A target with two artefacts on by default, the second needing the first, and `nativeDocs` declared off.
const DECLARED: readonly ArtefactDeclaration[] = [
  { id: "types", defaultOn: true },
  { id: "routes", defaultOn: true, needs: ["types"] },
  { id: "nativeDocs", defaultOn: false },
];

function select(artefacts: ArtefactSwitches | undefined, declared = DECLARED) {
  const entry = {
    id: "server",
    use: "@acme/codegen-server",
    api: "tasks",
    ...(artefacts === undefined ? {} : { artefacts }),
  };

  return selectArtefacts(entry, stubTarget("@acme/codegen-server", declared));
}

function selected(artefacts: ArtefactSwitches | undefined): string[] {
  const outcome = select(artefacts);

  if (outcome.status === "refused") throw new Error(JSON.stringify(outcome.problems));

  return [...outcome.artefacts];
}

test("generates the declared defaults, nativeDocs off, when the entry switches nothing", () => {
  expect(selected(undefined)).toEqual(["types", "routes"]);
});

test("switches nativeDocs on and an artefact nothing needs off", () => {
  expect(selected({ nativeDocs: true, routes: false })).toEqual(["types", "nativeDocs"]);
});

test("follows a target that declares nativeDocs on", () => {
  const outcome = select(undefined, [{ id: "nativeDocs", defaultOn: true }]);

  expect(outcome).toEqual({ status: "selected", artefacts: new Set(["nativeDocs"]) });
});

test("leaves the artefacts at their defaults for the boot check's object form", () => {
  const outcome = select({ bootCheck: { frameworkRoutes: false } }, [
    { id: "boundary", defaultOn: true },
    { id: "bootCheck", defaultOn: true },
  ]);

  expect(outcome).toEqual({ status: "selected", artefacts: new Set(["boundary", "bootCheck"]) });
});

test("switches the boot check off as a boolean", () => {
  const outcome = select({ bootCheck: false }, [
    { id: "boundary", defaultOn: true },
    { id: "bootCheck", defaultOn: true },
  ]);

  expect(outcome).toEqual({ status: "selected", artefacts: new Set(["boundary"]) });
});

// A Node server target as the Express package builds it: a boundary artefact and tunable boot checks, no
// `bootCheck` artefact. A core package may not depend on a target package, so the test builds it here.
const NODE_SERVER_TARGET = nodeServerTarget({
  packageName: "@seampact/codegen-express",
  packageVersion: "1.0.0",
  format: async (source) => source,
  placement: {
    runtimeModule: "express-boundary",
    runtimeSourceUrl: new URL("./express-boundary.ts", import.meta.url),
    frameworkModule: "express",
    frameworkSource: () => "",
  },
  validatorStyles: ["standard-schema"],
});

test.each([false, true])(
  "takes the boot check as a boolean for a target that declares boot checks (bootCheck: %s)",
  (bootCheck) => {
    const entry = {
      id: "server",
      use: "@seampact/codegen-express",
      api: "tasks",
      artefacts: { bootCheck },
    };

    expect(selectArtefacts(entry, NODE_SERVER_TARGET)).toEqual({
      status: "selected",
      artefacts: new Set(["boundary"]),
    });
  },
);

test("refuses the boot check as a boolean for a target that declares no boot check", () => {
  expect(select({ bootCheck: false }, [{ id: "boundary", defaultOn: true }])).toMatchObject({
    status: "refused",
    problems: [{ code: "config.artefacts.unknown" }],
  });
});

test("refuses a switch the target does not declare, naming the declared artefacts", () => {
  expect(select({ client: false })).toEqual({
    status: "refused",
    problems: [
      {
        code: "config.artefacts.unknown",
        message:
          "The target '@acme/codegen-server' declares no artefact 'client'; it declares 'types', 'routes', 'nativeDocs'.",
        fix: "Remove 'client' from the entry's `artefacts`, or switch one of the artefacts the target declares.",
        where: "entry 'server'",
      },
    ],
  });
});

test("points an undeclared nativeDocs at the seampact OpenAPI document", () => {
  const outcome = select({ nativeDocs: true }, [{ id: "boundary", defaultOn: true }]);

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.artefacts.unknown",
        fix: expect.stringContaining("`openapi/<api>.yaml`"),
      },
    ],
  });
});

test("refuses switching off an artefact another generated one needs, naming both", () => {
  expect(select({ types: false })).toEqual({
    status: "refused",
    problems: [
      {
        code: "config.artefacts.needed",
        message:
          "The artefact 'routes' of the target '@acme/codegen-server' needs 'types', which the entry leaves off.",
        fix: "Switch 'types' on, or switch 'routes' off too.",
        where: "entry 'server'",
      },
    ],
  });
});

test("refuses an entry with every artefact off", () => {
  expect(select({ types: false, routes: false })).toEqual({
    status: "refused",
    problems: [
      {
        code: "config.artefacts.none",
        message:
          "The entry leaves off every artefact the target '@acme/codegen-server' declares ('types', 'routes', 'nativeDocs'), so it would generate nothing.",
        fix: "Remove the entry from `targets`, or switch one of its artefacts on.",
        where: "entry 'server'",
      },
    ],
  });
});
