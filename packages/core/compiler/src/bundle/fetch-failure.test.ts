import { expect, test } from "vitest";
import { bundleSourceText } from "./fetch-failure.js";

test("a source's text for messages never holds the token of its URL", () => {
  const tokenUrl = "https://x-access-token:SECRET@github.com/o/r.git?t=S2";

  const gitText = bundleSourceText({ git: { url: tokenUrl, tag: "v1" } });
  const releaseText = bundleSourceText({ release: { url: tokenUrl } });

  expect(gitText).toBe("git 'https://github.com/o/r.git' tag 'v1'");
  expect(releaseText).toBe("release 'https://github.com/o/r.git'");
});
