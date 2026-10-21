import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { useTarballs, withTargetOptions } from "./consumer-project.ts";

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
