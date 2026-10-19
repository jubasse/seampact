import { describe, expect, test } from "vitest";
import type { GeneratedFile } from "../target.js";
import { nodeServerRuntimeFiles, type ServerRuntimeProfile } from "./runtime-files.js";

const NODE_IMPORT = /from "(node:[^"]+)"/g;
const RELATIVE_IMPORT = /from "\.\/([^"]+)\.js"/g;
// The one Node module the Web-standard runtimes provide (Bun, Deno, Next.js; Workers with `nodejs_als`).
const WEB_ALLOWED_NODE_IMPORTS = ["node:async_hooks"];

function moduleNames(files: readonly GeneratedFile[]): string[] {
  return files.map((file) => file.path.slice(file.path.lastIndexOf("/") + 1));
}

function importsOf(file: GeneratedFile, pattern: RegExp): string[] {
  return [...file.contents.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("server runtime profiles", () => {
  test("the node profile copies every module but the web ones under node-server/", () => {
    const files = nodeServerRuntimeFiles("node");

    expect(files.every((file) => file.path.startsWith("node-server/"))).toBe(true);
    expect(moduleNames(files)).toContain("node-outgoing-check.ts");
    expect(moduleNames(files).some((name) => name.startsWith("web-"))).toBe(false);
  });

  test("the web profile copies no node module under web-server/", () => {
    const files = nodeServerRuntimeFiles("web");

    expect(files.every((file) => file.path.startsWith("web-server/"))).toBe(true);
    expect(moduleNames(files)).toContain("outgoing-verdict.ts");
    expect(moduleNames(files).some((name) => name.startsWith("node-"))).toBe(false);
  });

  test("the web profile imports no node: module but node:async_hooks", () => {
    const nodeImports = nodeServerRuntimeFiles("web").flatMap((file) =>
      importsOf(file, NODE_IMPORT),
    );

    expect(nodeImports.filter((name) => !WEB_ALLOWED_NODE_IMPORTS.includes(name))).toEqual([]);
  });

  test.each<ServerRuntimeProfile>(["node", "web"])(
    "every relative import of the %s profile is a module it copies",
    (profile) => {
      const files = nodeServerRuntimeFiles(profile);
      const copied = new Set(moduleNames(files));
      const dangling = files.flatMap((file) =>
        importsOf(file, RELATIVE_IMPORT)
          .filter((module) => !copied.has(`${module}.ts`))
          .map((module) => `${file.path} imports ./${module}.js`),
      );

      expect(dangling).toEqual([]);
    },
  );
});
