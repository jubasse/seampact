import { describe, expect, it } from "vitest";
import { pluginPublishOutcome } from "./publish-plugin.ts";

const VERSION = "1.2.3";

describe("the Plugin Portal publish outcome", () => {
  it("is published when the Gradle run succeeds", () => {
    expect(pluginPublishOutcome(0, "BUILD SUCCESSFUL", VERSION)).toBe("published");
  });

  it("counts the portal's already-exists answer for the version as published", () => {
    const output = [
      "FAILURE: Build failed with an exception.",
      `Failed to post to server. Server responded with: Plugin version '${VERSION}' already exists for plugin 'io.github.jubasse.seampact'`,
    ].join("\n");

    expect(pluginPublishOutcome(1, output, VERSION)).toBe("already-exists");
  });

  it("fails on any other failure, an already-exists answer for another version included", () => {
    expect(() => pluginPublishOutcome(1, "Invalid credentials", VERSION)).toThrow(
      /failed with exit code 1/,
    );
    expect(() => pluginPublishOutcome(1, "Plugin version '1.2.2' already exists", VERSION)).toThrow(
      /did not answer that io\.github\.jubasse\.seampact 1\.2\.3 already exists/,
    );
  });
});
