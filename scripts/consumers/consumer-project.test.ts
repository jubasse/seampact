import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { overlayChain, useTarballs, withTargetOptions } from "./consumer-project.ts";

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

// A targets directory holding one overlay per entry, each with the base it names, if any.
function targetsWith(bases: Record<string, string | undefined>): string {
  const root = mkdtempSync(join(tmpdir(), "consumer-overlays-"));

  directories.push(root);

  for (const [overlay, base] of Object.entries(bases)) {
    mkdirSync(join(root, overlay));

    if (base !== undefined) writeFileSync(join(root, overlay, "overlay.base"), `${base}\n`);
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
