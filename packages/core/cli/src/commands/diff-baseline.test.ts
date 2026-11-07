import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readBaseline } from "./diff-baseline.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-baseline-"));

  directories.push(directory);

  return directory;
}

async function refusalOf(path: string): Promise<string> {
  const read = await readBaseline(path);

  if (read.status !== "refused") throw new Error("expected the baseline to be refused");

  expect(read.problems.map(({ code }) => code)).toEqual(
    read.problems.map(() => "diff.against.invalid"),
  );

  return read.problems.map(({ message }) => message).join("\n");
}

test("a path that does not exist is refused by name", async () => {
  expect(await refusalOf(join(temporaryDirectory(), "nowhere"))).toContain("does not exist");
});

test("a directory with no IR file is refused", async () => {
  const directory = temporaryDirectory();

  writeFileSync(join(directory, "notes.txt"), "");

  expect(await refusalOf(directory)).toContain("holds no `*.ir.json` file");
});

test("a file that is not JSON is refused with the parse error", async () => {
  const directory = temporaryDirectory();
  const file = join(directory, "tasks.ir.json");

  writeFileSync(file, "{ not json");

  expect(await refusalOf(file)).toContain(`'${file}' is not JSON`);
});

test("an IR file that breaks the IR schema is refused with the pointer", async () => {
  const directory = temporaryDirectory();
  const file = join(directory, "tasks.ir.json");

  writeFileSync(file, JSON.stringify({ api: { id: "tasks" } }));

  expect(await refusalOf(file)).toContain("is not valid under the IR JSON Schema");
});

test("every invalid file of a directory is named, not only the first", async () => {
  const directory = temporaryDirectory();

  mkdirSync(join(directory, "nested"));
  writeFileSync(join(directory, "a.ir.json"), "[]");
  writeFileSync(join(directory, "b.ir.json"), "oops");

  const message = await refusalOf(directory);

  expect(message).toContain("a.ir.json");
  expect(message).toContain("b.ir.json");
});
