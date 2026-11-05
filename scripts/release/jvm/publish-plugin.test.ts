import { describe, expect, it } from "vitest";
import { pluginPublishMessage, pluginPublishOutcome } from "./publish-plugin.ts";

const VERSION = "1.0.0";
const SERVER = "Failed to post to server. Server responded with:";

describe("the Plugin Portal publish outcome", () => {
  it("is published when the Gradle run succeeds", () => {
    expect(pluginPublishOutcome(0, "BUILD SUCCESSFUL", VERSION)).toBe("published");
  });

  it("counts the portal's already-exists answer for the plugin and the version as published", () => {
    const output = [
      "FAILURE: Build failed with an exception.",
      `${SERVER} Plugin version '${VERSION}' already exists for plugin 'io.github.jubasse.seampact'`,
    ].join("\n");

    expect(pluginPublishOutcome(1, output, VERSION)).toBe("already-exists");
  });

  it.each([
    [
      "a file-system error on a path holding the version",
      `Could not write /tmp/${VERSION}/x: file already exists`,
    ],
    [
      "another plugin's answer",
      `${SERVER} Plugin io.github.someone.else version ${VERSION} already exists`,
    ],
    [
      "a plugin id taken by another user",
      `${SERVER} Plugin id 'io.github.jubasse.seampact' already exists, owned by another user (requested version ${VERSION})`,
    ],
    [
      "a longer version holding the version",
      `${SERVER} Plugin version '1${VERSION}' already exists for plugin 'io.github.jubasse.seampact'`,
    ],
    ["any other failure", "Invalid credentials"],
  ])("fails on %s", (_case, output) => {
    expect(() => pluginPublishOutcome(1, output, VERSION)).toThrow(
      `publishPlugins failed with exit code 1 (Gradle's output above), and the portal did not answer that io.github.jubasse.seampact ${VERSION} already exists`,
    );
  });

  it("warns the release reviewer when the answer is counted as published", () => {
    expect(pluginPublishMessage("already-exists", VERSION)).toMatch(
      /^::warning title=Gradle plugin counted as published::.*io\.github\.jubasse\.seampact 1\.0\.0 already exists/,
    );
    expect(pluginPublishMessage("published", VERSION)).toBe(
      `publish-plugin: io.github.jubasse.seampact ${VERSION} published`,
    );
  });
});
