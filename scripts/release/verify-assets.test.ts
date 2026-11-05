import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifiedAssets } from "./verify-assets.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// Two assets and the manifest of them; answers the directory and the manifest's own SHA-256.
function assets(): { directory: string; manifestSha256: string } {
  const directory = mkdtempSync(join(tmpdir(), "release-assets-"));
  const manifest = `${sha256("linux")}  seampact-linux-x64\n${sha256("windows")}  seampact-win32-x64.exe\n`;

  directories.push(directory);
  writeFileSync(join(directory, "seampact-linux-x64"), "linux");
  writeFileSync(join(directory, "seampact-win32-x64.exe"), "windows");
  writeFileSync(join(directory, "SHA256SUMS"), manifest);

  return { directory, manifestSha256: sha256(manifest) };
}

describe("the release asset check", () => {
  it("answers the assets when the manifest is the one the call hashed and every file matches", () => {
    const { directory, manifestSha256 } = assets();

    expect(verifiedAssets(directory, manifestSha256)).toEqual([
      "seampact-linux-x64",
      "seampact-win32-x64.exe",
    ]);
  });

  it("refuses a manifest other than the one the call hashed, and an empty call output", () => {
    const { directory } = assets();

    expect(() => verifiedAssets(directory, sha256("other"))).toThrow(
      "these are not the assets the call hashed",
    );
    expect(() => verifiedAssets(directory, "")).toThrow("the binary call output nothing");
  });

  it("names a changed, a missing and an unlisted asset", () => {
    const { directory, manifestSha256 } = assets();

    writeFileSync(join(directory, "seampact-linux-x64"), "tampered");
    rmSync(join(directory, "seampact-win32-x64.exe"));
    writeFileSync(join(directory, "notes.txt"), "stray");

    expect(() => verifiedAssets(directory, manifestSha256)).toThrow(
      "seampact-linux-x64 does not have the hash SHA256SUMS lists; seampact-win32-x64.exe is listed in SHA256SUMS " +
        "but missing; notes.txt is not listed in SHA256SUMS",
    );
  });
});
