import { expect, test } from "vitest";
import { SPEC_PACKAGE_NAME } from "./index.js";

test("exposes the package name", () => {
  expect(SPEC_PACKAGE_NAME).toBe("@seampact/spec");
});
