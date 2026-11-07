import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
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

  expect(readInstalledVersion(join(root, "app"), "web-framework", "framework", WHERE)).toEqual({
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
    readInstalledVersion(join(root, "apps/web"), "@acme/framework", "framework", WHERE),
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

  expect(readInstalledVersion(root, "web-framework-absent", "framework", WHERE)).toEqual({
    status: "refused",
    problem: {
      code: "config.matrix.framework-missing",
      message: `The framework package 'web-framework-absent' is not installed in the project of the entry's output directory (${root}), so its version cannot be checked against the compatibility matrix; the generated code imports it.`,
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

  expect(readInstalledVersion(root, "web-framework", "framework", WHERE)).toMatchObject({
    status: "refused",
    problem: { code: "config.matrix.version-unreadable" },
  });
});

test("names a validator library as such when its version cannot be read", () => {
  const root = writeConfigTree({
    "seampact.config.yaml": "",
    "node_modules/schema-library/package.json": JSON.stringify({ version: "latest" }),
  });

  expect(readInstalledVersion(root, "schema-library", "validatorLibrary", WHERE)).toEqual({
    status: "refused",
    problem: {
      code: "config.matrix.version-unreadable",
      message: `The installed validator library 'schema-library' has no version the CLI can read: ${join(root, "node_modules/schema-library/package.json")} declares no \`version\` of the form <major>.<minor>.<patch>.`,
      fix: "Reinstall 'schema-library' with your package manager.",
      where: WHERE,
    },
  });
});

test("refuses a Plug'n'Play project by name, with the node-modules linker as the fix", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    ".pnp.cjs": "",
    "yarn.lock": "",
  });

  expect(readInstalledVersion(join(root, "app"), "web-framework", "framework", WHERE)).toEqual({
    status: "refused",
    problem: {
      code: "config.matrix.pnp-unsupported",
      message: `The project around ${join(root, "app")} installs its packages with Yarn Plug'n'Play (${join(root, ".pnp.cjs")}), which the CLI cannot read the version of 'web-framework' from.`,
      fix: "Set `nodeLinker: node-modules` in the project's `.yarnrc.yml`, then run `yarn install`.",
      where: WHERE,
    },
  });
});
