import { afterEach, expect, test } from "vitest";
import { join } from "node:path";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { readInstalledVersion } from "./installed-version.js";

afterEach(removeConfigTrees);

const WHERE = "entry 'server'";

test("reads a package.json the package's exports hide", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({
      name: "web-framework",
      version: "5.2.1",
      exports: { ".": "./index.js" },
    }),
  });

  expect(
    readInstalledVersion(join(root, "app/seampact.config.yaml"), "web-framework", WHERE),
  ).toEqual({
    status: "installed",
    installed: { packageName: "web-framework", version: "5.2.1", major: 5 },
  });
});

test("finds a package hoisted above the app, and counts a pre-release by its major", () => {
  const root = writeConfigTree({
    "apps/web/seampact.config.yaml": "",
    "node_modules/@acme/framework/package.json": JSON.stringify({ version: "6.0.0-beta.2" }),
  });

  expect(
    readInstalledVersion(join(root, "apps/web/seampact.config.yaml"), "@acme/framework", WHERE),
  ).toEqual({
    status: "installed",
    installed: { packageName: "@acme/framework", version: "6.0.0-beta.2", major: 6 },
  });
});

test("refuses a missing package with the runtime install command of the app's package manager", () => {
  const root = writeConfigTree({
    "seampact.config.yaml": "",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });

  expect(
    readInstalledVersion(join(root, "seampact.config.yaml"), "web-framework-absent", WHERE),
  ).toEqual({
    status: "refused",
    problem: {
      code: "config.matrix.framework-missing",
      message:
        "The framework package 'web-framework-absent' is not installed in the app's project, so its version cannot be checked against the compatibility matrix; the generated code imports it.",
      fix: "Install it: `pnpm add web-framework-absent`.",
      where: WHERE,
    },
  });
});

test("refuses an installed package without a readable version", () => {
  const root = writeConfigTree({
    "seampact.config.yaml": "",
    "node_modules/web-framework/package.json": JSON.stringify({ version: "latest" }),
  });

  expect(
    readInstalledVersion(join(root, "seampact.config.yaml"), "web-framework", WHERE),
  ).toMatchObject({
    status: "refused",
    problem: { code: "config.matrix.version-unreadable" },
  });
});
