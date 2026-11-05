import { describe, expect, it } from "vitest";
import { ReleasePinsError, releasePinsFromSha256Sums, releasePinsText } from "./release-pins.js";

const ASSETS = ["seampact-linux-x64", "seampact-win32-x64.exe"];
const LINUX_HASH = "a".repeat(64);
const WINDOWS_HASH = "b".repeat(64);
const MANIFEST = `${LINUX_HASH}  seampact-linux-x64\n${WINDOWS_HASH}  seampact-win32-x64.exe\n`;

describe("releasePinsFromSha256Sums", () => {
  it("pins every asset of the manifest under the release version", () => {
    const pins = releasePinsFromSha256Sums("1.0.0", MANIFEST, ASSETS);

    expect(pins).toEqual({
      version: "1.0.0",
      sha256: { "seampact-linux-x64": LINUX_HASH, "seampact-win32-x64.exe": WINDOWS_HASH },
    });
  });

  it("writes the layout of the empty pin, in asset order whatever the manifest order", () => {
    const reversed = `${WINDOWS_HASH}  seampact-win32-x64.exe\n${LINUX_HASH}  seampact-linux-x64`;
    const text = releasePinsText(releasePinsFromSha256Sums("1.0.0-rc.1", reversed, ASSETS));

    expect(text).toBe(
      `{\n  "version": "1.0.0-rc.1",\n  "sha256": {\n    "seampact-linux-x64": "${LINUX_HASH}",\n    "seampact-win32-x64.exe": "${WINDOWS_HASH}"\n  }\n}\n`,
    );
  });

  it.each([
    ["no version", "", MANIFEST, "'' is no release version"],
    ["a version that is not semver", "1.0", MANIFEST, "'1.0' is no release version"],
    [
      "a missing asset",
      "1.0.0",
      `${LINUX_HASH}  seampact-linux-x64\n`,
      "no hash for seampact-win32-x64.exe",
    ],
    [
      "an unknown asset",
      "1.0.0",
      `${MANIFEST}${LINUX_HASH}  seampact-freebsd-x64\n`,
      "'seampact-freebsd-x64', which is no release binary",
    ],
    [
      "an asset listed twice",
      "1.0.0",
      `${MANIFEST}${LINUX_HASH}  seampact-linux-x64\n`,
      "'seampact-linux-x64' twice",
    ],
    ["an uppercase hash", "1.0.0", MANIFEST.replace(LINUX_HASH, "A".repeat(64)), "line 1 is not"],
    [
      "a binary-mode line",
      "1.0.0",
      MANIFEST.replace("  seampact-win32", " *seampact-win32"),
      "line 2 is not",
    ],
    ["a blank line", "1.0.0", `${MANIFEST}\n`, "line 3 is not"],
  ])("refuses %s", (_case, version, manifest, problem) => {
    expect(() => releasePinsFromSha256Sums(version, manifest, ASSETS)).toThrow(ReleasePinsError);
    expect(() => releasePinsFromSha256Sums(version, manifest, ASSETS)).toThrow(problem);
  });
});
