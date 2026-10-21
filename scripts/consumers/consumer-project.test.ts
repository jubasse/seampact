import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "../golden/repo-root.ts";
import {
  assembleConsumer,
  overlayChain,
  useTarballs,
  withTargetOptions,
} from "./consumer-project.ts";
import { validatorChoice } from "./validator-choice.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function appWith(workspaceFile: string | undefined): string {
  const directory = mkdtempSync(join(tmpdir(), "consumer-project-"));

  directories.push(directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), "{}\n");

  if (workspaceFile !== undefined)
    writeFileSync(join(directory, "pnpm-workspace.yaml"), workspaceFile);

  return directory;
}

function workspaceOf(directory: string): unknown {
  return parse(readFileSync(join(directory, "pnpm-workspace.yaml"), "utf8"));
}

test("merges the tarball overrides into the app's own pnpm-workspace.yaml", () => {
  const directory = appWith("allowBuilds:\n  '@swc/core': true\noverrides:\n  left-pad: 1.3.0\n");

  useTarballs(directory, new Map([["@seampact/spec", "spec.tgz"]]));

  expect(workspaceOf(directory)).toEqual({
    allowBuilds: { "@swc/core": true, esbuild: true },
    overrides: { "left-pad": "1.3.0", "@seampact/spec": "file:./vendor/seampact/spec.tgz" },
  });
});

test("writes the settings when the app has no pnpm-workspace.yaml", () => {
  const directory = appWith(undefined);

  useTarballs(directory, new Map([["@seampact/spec", "spec.tgz"]]));

  expect(workspaceOf(directory)).toEqual({
    allowBuilds: { esbuild: true },
    overrides: { "@seampact/spec": "file:./vendor/seampact/spec.tgz" },
  });
});

test("writes each target option into every entry's options, read as YAML", () => {
  const entries = [
    "  - id: server",
    '    use: "@seampact/codegen-nestjs"',
    "    options:",
    "      bodyValidation: true",
    "  # The variant entry.",
    "  - id: variant",
    '    use: "@seampact/codegen-nestjs"',
  ].join("\n");
  const written = withTargetOptions(entries, [
    { key: "reply", value: "interceptor" },
    { key: "catchAll", value: "false" },
  ]);

  expect(parse(written)).toEqual([
    {
      id: "server",
      use: "@seampact/codegen-nestjs",
      options: { bodyValidation: true, reply: "interceptor", catchAll: false },
    },
    {
      id: "variant",
      use: "@seampact/codegen-nestjs",
      options: { reply: "interceptor", catchAll: false },
    },
  ]);
  expect(written).toContain("# The variant entry.");
  expect(written.startsWith("  - id: server")).toBe(true);
});

// A targets directory holding one overlay per entry, each with the base or bases it names, if any.
function targetsWith(bases: Record<string, string | readonly string[] | undefined>): string {
  const root = mkdtempSync(join(tmpdir(), "consumer-overlays-"));

  directories.push(root);

  for (const [overlay, base] of Object.entries(bases)) {
    mkdirSync(join(root, overlay));

    if (base !== undefined)
      writeFileSync(join(root, overlay, "overlay.base"), `${[base].flat().join("\n")}\n`);
  }

  return root;
}

test("an overlay chain of any depth lists the deepest base first", () => {
  const root = targetsWith({ hono: undefined, front: "hono", "front-fetch": "front" });

  expect(overlayChain(root, "front-fetch")).toEqual(
    ["hono", "front", "front-fetch"].map((overlay) => join(root, overlay)),
  );
});

test("an overlay chain that comes back to one of its overlays is refused, naming the cycle", () => {
  const root = targetsWith({ front: "react", react: "front" });

  expect(() => overlayChain(root, "front")).toThrow(
    "consumers: the overlay bases form a cycle: front -> react -> front",
  );
});

test("an overlay naming itself as its base is refused as a cycle", () => {
  const root = targetsWith({ hono: "hono" });

  expect(() => overlayChain(root, "hono")).toThrow("cycle: hono -> hono");
});

test("a base that names no overlay is refused with the known targets", () => {
  const root = targetsWith({ front: "missing" });

  expect(() => overlayChain(root, "front")).toThrow(
    "consumers: no overlay for target 'missing'; known targets: front.",
  );
});

test("an overlay naming several bases lists them in order, each chain before the overlay", () => {
  const root = targetsWith({ hono: undefined, front: undefined, "front-fetch": ["hono", "front"] });

  expect(overlayChain(root, "front-fetch")).toEqual(
    ["hono", "front", "front-fetch"].map((overlay) => join(root, overlay)),
  );
});

test("an overlay reached through two paths is listed once, at its first place", () => {
  const root = targetsWith({
    hono: undefined,
    front: "hono",
    react: ["hono", "front"],
    "react-tanstack": ["hono", "react"],
  });

  expect(overlayChain(root, "react-tanstack")).toEqual(
    ["hono", "front", "react", "react-tanstack"].map((overlay) => join(root, overlay)),
  );
});

test("a cycle through the second base is refused, naming the path", () => {
  const root = targetsWith({ hono: undefined, front: "react", react: ["hono", "front"] });

  expect(() => overlayChain(root, "react")).toThrow("cycle: react -> front -> react");
});

test("the front overlay alone adds no server entry, so its Vitest config runs the browser project only", () => {
  const directory = join(mkdtempSync(join(tmpdir(), "consumer-front-")), "app");

  directories.push(join(directory, ".."));

  assembleConsumer({
    consumersRoot: join(REPO_ROOT, "scripts/consumers"),
    repositoryRoot: REPO_ROOT,
    target: "front",
    validators: validatorChoice("zod"),
    directory,
    commit: "test",
  });

  expect(existsSync(join(directory, "vitest.config.mts"))).toBe(true);
  expect(existsSync(join(directory, "test/server.mts"))).toBe(false);
});
