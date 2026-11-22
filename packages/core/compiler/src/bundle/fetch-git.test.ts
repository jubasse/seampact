import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { temporaryDirectory } from "./bundle.test-support.js";
import { fetchGitBundle } from "./fetch-git.js";

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

// A `git` that makes a sparse file past the cap in the repository it is given, then hangs.
test("a fetch that grows the repository past the cap is killed and removed", async () => {
  const fakeBin = temporaryDirectory();
  const script = join(fakeBin, "git");

  writeFileSync(
    script,
    '#!/bin/sh\nfor a in "$@"; do case "$a" in --git-dir=*) dir="${a#--git-dir=}";; esac; done\nmkdir -p "$dir"\ncase "$*" in *fetch*) truncate -s 300M "$dir/pack"; exec sleep 30;; esac\n',
  );
  chmodSync(script, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath}`;

  const result = await fetchGitBundle(
    { git: { url: "https://example.test/r.git", tag: "v1" } },
    temporaryDirectory(),
    "refuse",
  );

  expect(result.ok).toBe(false);

  if (result.ok) return;

  expect(result.failure.code).toBe("bundle.git-failed");
  expect(result.failure.message).toContain("grew past");
});
