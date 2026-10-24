import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { gitIgnoreWithEntries } from "./git-ignore.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function folderWithIgnore(text: string | undefined): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-git-ignore-"));

  directories.push(directory);

  if (text !== undefined) writeFileSync(join(directory, ".gitignore"), text);

  return directory;
}

test("a missing .gitignore is created with the entry", async () => {
  expect(await gitIgnoreWithEntries(folderWithIgnore(undefined), [".seampact/"])).toMatchObject({
    change: "created",
    text: ".seampact/\n",
  });
});

test("the entry is appended after a last line without a newline", async () => {
  expect(await gitIgnoreWithEntries(folderWithIgnore("dist"), [".seampact/"])).toMatchObject({
    change: "appended",
    text: "dist\n.seampact/\n",
  });
});

test("a CRLF .gitignore gets the entry with CRLF", async () => {
  expect(
    await gitIgnoreWithEntries(folderWithIgnore("node_modules\r\n"), [".seampact/"]),
  ).toMatchObject({ change: "appended", text: "node_modules\r\n.seampact/\r\n" });
});

test("the entry with or without its trailing slash counts as present", async () => {
  for (const text of ["node_modules\n.seampact/\n", ".seampact\r\n"]) {
    expect(await gitIgnoreWithEntries(folderWithIgnore(text), [".seampact/"])).toMatchObject({
      change: "unchanged",
      text,
    });
  }
});

test("an anchored /.seampact/ does not ignore nested folders, so the entry is added", async () => {
  expect(
    await gitIgnoreWithEntries(folderWithIgnore("/.seampact/\n"), [".seampact/"]),
  ).toMatchObject({
    change: "appended",
    text: "/.seampact/\n.seampact/\n",
  });
});

test("a .gitignore that is a symbolic link is reported, not read", async () => {
  const target = folderWithIgnore("elsewhere\n");
  const directory = folderWithIgnore(undefined);

  symlinkSync(join(target, ".gitignore"), join(directory, ".gitignore"));

  expect(await gitIgnoreWithEntries(directory, [".seampact/"])).toMatchObject({ change: "link" });
});
