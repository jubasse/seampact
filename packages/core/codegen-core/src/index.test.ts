import { expect, test } from "vitest";
import { PACKAGE_NAME } from "./index.js";

test("exposes the package name", () => {
  expect(PACKAGE_NAME).toBe("@seampact/codegen-core");
});
