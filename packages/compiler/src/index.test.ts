import type { Origin } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Diagnostic } from "./diagnostics/diagnostic.js";
import { PACKAGE_NAME } from "./index.js";

test("exposes the package name", () => {
  expect(PACKAGE_NAME).toBe("@seampact/compiler");
});

test("builds a Diagnostic from an Origin of the spec subpath", () => {
  const origin: Origin = { layer: "api", pointer: "/operations/a" };
  const diagnostic: Diagnostic = {
    severity: "error",
    rule: "seampact/access/deny-by-default",
    message: "m",
    fix: "f",
    origin,
    related: [{ origin: { layer: "base", pointer: "/x" }, message: "other" }],
  };
  expect(diagnostic.related[0]?.origin.layer).toBe("base");
});
