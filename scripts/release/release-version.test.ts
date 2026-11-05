import { describe, expect, it } from "vitest";
import { isLatestRelease } from "./latest-release.ts";
import { DRY_RUN_VERSION, ReleaseError, runVersion } from "./release-version.ts";

describe("the version of a run", () => {
  it("refuses the development version for a real run, by name, and accepts it for a dry run", () => {
    expect(() => runVersion("0.0.0", "real")).toThrow(
      "0.0.0 is the development version every package carries between releases",
    );
    expect(runVersion("0.0.0", "dry-run")).toBe("0.0.0");
    expect(runVersion(DRY_RUN_VERSION, "dry-run")).toBe("0.0.1");
    expect(runVersion("1.0.0", "real")).toBe("1.0.0");
    expect(() => runVersion("1.0.0-rc.1", "dry-run")).toThrow(ReleaseError);
  });
});

describe("the latest mark of a release", () => {
  it("goes to a version above every published release only", () => {
    expect(isLatestRelease("1.0.0", [])).toBe(true);
    expect(isLatestRelease("1.2.0", ["v1.1.9", "v1.0.0"])).toBe(true);
    expect(isLatestRelease("1.10.0", ["v1.9.0"])).toBe(true);
    expect(isLatestRelease("1.1.4", ["v1.1.3", "v1.2.0"])).toBe(false);
    expect(isLatestRelease("1.2.0", ["v1.2.0"])).toBe(false);
  });

  it("compares the tags of this workflow only", () => {
    expect(isLatestRelease("1.0.0", ["v2.0.0-rc.1", "binary-9.0.0", "v1.0"])).toBe(true);
  });
});
