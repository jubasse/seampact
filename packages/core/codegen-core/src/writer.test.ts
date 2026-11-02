import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { checkGeneratedPaths } from "./generated-paths.js";
import { planGeneratedWrite, writeGeneratedFiles } from "./writer.js";

let sandbox: string;
let outDir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "seampact-writer-"));
  outDir = join(sandbox, "out");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function codesOf(outcome: Awaited<ReturnType<typeof writeGeneratedFiles>>): string[] {
  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("the writer stays inside its directory and keeps hand-written files", async () => {
  const outsideFile = join(sandbox, "outside.ts");

  await writeFile(outsideFile, "outside\n");

  // A first run writes normalized bytes and a manifest.
  const first = await writeGeneratedFiles(outDir, "node-server", [
    { path: "routes/tasks.ts", contents: "﻿export const tasks = 1;\r\n" },
    { path: "index.ts", contents: "export {};" },
  ]);

  expect(first).toMatchObject({ status: "written", written: ["index.ts", "routes/tasks.ts"] });
  expect(await readFile(join(outDir, "routes/tasks.ts"), "utf8")).toBe("export const tasks = 1;\n");
  expect(await readFile(join(outDir, "index.ts"), "utf8")).toBe("export {};\n");

  // Paths that leave the directory are refused before anything is written.
  for (const path of ["../outside.ts", "/etc/passwd", "a/../../outside.ts", "a\\..\\outside.ts"]) {
    expect(
      codesOf(await writeGeneratedFiles(outDir, "node-server", [{ path, contents: "x" }])),
    ).toEqual(["file.path.invalid"]);
  }

  // A symbolic link out of the directory is refused, not followed.
  await symlink(sandbox, join(outDir, "escape"));
  expect(
    codesOf(
      await writeGeneratedFiles(outDir, "node-server", [
        { path: "escape/outside.ts", contents: "x" },
      ]),
    ),
  ).toEqual(["writer.path.outside"]);
  await rm(join(outDir, "escape"));

  // A file the writer did not generate, and a hand-edited generated file, are kept, and nothing is written.
  await writeFile(join(outDir, "hand-written.ts"), "mine\n");
  await writeFile(join(outDir, "index.ts"), "export {}; // edited\n");

  const refused = await writeGeneratedFiles(outDir, "node-server", [
    { path: "hand-written.ts", contents: "generated" },
    { path: "index.ts", contents: "export {};" },
  ]);

  expect(codesOf(refused)).toEqual(["writer.file.not-generated", "writer.file.edited"]);
  expect(await readFile(join(outDir, "hand-written.ts"), "utf8")).toBe("mine\n");
  expect(await readFile(join(outDir, "index.ts"), "utf8")).toBe("export {}; // edited\n");
  expect(await readFile(join(outDir, "routes/tasks.ts"), "utf8")).toBe("export const tasks = 1;\n");

  // Once the edit is undone, a file no longer produced is removed with its empty directory; others stay.
  await writeFile(join(outDir, "index.ts"), "export {};\n");

  const second = await writeGeneratedFiles(outDir, "node-server", [
    { path: "index.ts", contents: "export const index = 2;" },
  ]);

  expect(second).toEqual({
    status: "written",
    written: ["index.ts"],
    unchanged: [],
    removed: ["routes/tasks.ts"],
  });
  expect(await readFile(join(outDir, "hand-written.ts"), "utf8")).toBe("mine\n");
  await expect(readFile(join(outDir, "routes/tasks.ts"), "utf8")).rejects.toThrow("ENOENT");
  await expect(mkdir(join(outDir, "routes"))).resolves.toBeUndefined();

  // A tampered manifest cannot make the writer delete outside its directory.
  await writeFile(
    join(outDir, ".seampact-manifest.json"),
    JSON.stringify({ files: [{ path: "../outside.ts", sha256: "0".repeat(64) }] }),
  );
  expect(codesOf(await writeGeneratedFiles(outDir, "node-server", []))).toEqual([
    "writer.manifest.invalid",
  ]);
  expect(await readFile(outsideFile, "utf8")).toBe("outside\n");
});

test("a symbolic link in place of the manifest is refused and nothing is written", async () => {
  const outsideFile = join(sandbox, "outside.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(outsideFile, "outside\n");
  await symlink(outsideFile, join(outDir, ".seampact-manifest.json"));

  const outcome = await writeGeneratedFiles(outDir, "node-server", [
    { path: "index.ts", contents: "export {};" },
  ]);

  expect(codesOf(outcome)).toEqual(["writer.manifest.not-regular"]);
  expect(await readFile(outsideFile, "utf8")).toBe("outside\n");
  expect(await readdir(outDir)).toEqual([".seampact-manifest.json"]);
});

test("a second target writing into the same directory is refused and nothing is written", async () => {
  await writeGeneratedFiles(outDir, "node-server", [{ path: "index.ts", contents: "export {};" }]);

  const outcome = await writeGeneratedFiles(outDir, "node-client", [
    { path: "client.ts", contents: "export {};" },
  ]);

  expect(codesOf(outcome)).toEqual(["writer.manifest.other-owner"]);
  expect((await readdir(outDir)).sort()).toEqual([".seampact-manifest.json", "index.ts"]);
});

test("two generated paths that differ only by case are refused by name and nothing is written", async () => {
  for (const [first, second] of [
    ["Tasks.ts", "tasks.ts"],
    ["routes/É.ts", "routes/é.ts"],
  ] as const) {
    const outcome = await writeGeneratedFiles(outDir, "node-server", [
      { path: first, contents: "a" },
      { path: second, contents: "b" },
    ]);

    expect(codesOf(outcome)).toEqual(["file.path.invalid"]);
    expect(outcome.status === "refused" ? outcome.refusals[0]?.message : "").toContain(
      `'${second}', and it differs only by letter case from '${first}'`,
    );
  }

  expect(await readdir(sandbox)).toEqual([]);
});

// The pairs every writer (Node, PHP, JVM, Python) proves its case fold on.
const CASE_FOLD_PAIRS: { first: string; second: string; collide: boolean }[] = JSON.parse(
  readFileSync(
    new URL("../../spec/vectors/generated-paths/case-fold.json", import.meta.url),
    "utf8",
  ),
).pairs;

function refusalsOfPaths(paths: readonly string[]): { code: string; message: string }[] {
  const checked = checkGeneratedPaths(paths.map((path) => ({ path, contents: "" })));

  return checked.status === "refused" ? checked.refusals : [];
}

test("the case fold agrees with the shared vector pairs", () => {
  for (const { first, second, collide } of CASE_FOLD_PAIRS) {
    expect(refusalsOfPaths([first, second]).length > 0, `${first} and ${second}`).toBe(collide);
  }
});

test("directories that differ only by case, or a file that is also a directory, are refused", () => {
  const cases = [
    ["Routes/a.ts", "routes/b.ts"],
    ["routes/b.ts", "Routes/a.ts"],
    ["routes", "Routes/a.ts"],
    ["Routes/a.ts", "routes"],
    ["routes", "routes/a.ts"],
  ];

  for (const paths of cases) {
    expect(
      refusalsOfPaths(paths).map((refusal) => refusal.code),
      paths.join(" "),
    ).toEqual(["file.path.invalid"]);
  }

  expect(refusalsOfPaths(["Routes/a.ts", "routes/b.ts"])[0]?.message).toContain(
    "differs only by letter case from the directory 'Routes'",
  );
});

test("a path repeated after a case variant is reported as generated twice", () => {
  const messages = refusalsOfPaths(["a.ts", "A.ts", "A.ts"]).map((refusal) => refusal.message);

  expect(messages).toHaveLength(2);
  expect(messages[0]).toContain("differs only by letter case from 'a.ts'");
  expect(messages[1]).toContain("it is generated twice");
});

test("a stale file renamed only by case gets its own message and fix", async () => {
  await writeGeneratedFiles(outDir, "node-server", [{ path: "Tasks.ts", contents: "a" }]);
  // What a case-insensitive disk shows: the new spelling already exists.
  await writeFile(join(outDir, "tasks.ts"), "a\n");

  const outcome = await planGeneratedWrite(outDir, "node-server", [
    { path: "tasks.ts", contents: "a" },
  ]);

  expect(outcome.status).toBe("refused");

  const refusal = outcome.status === "refused" ? outcome.refusals[0] : undefined;

  expect(refusal?.code).toBe("writer.file.not-generated");
  expect(refusal?.message).toContain("only by letter case");
  expect(refusal?.message).not.toContain("did not generate it");
  expect(refusal?.fix).toContain("Delete");
});
