import { describe, expect, test } from "vitest";
import { accessRightsExtensions } from "./read.js";
import { accessRightsQuoted } from "./report.js";

describe("raw tree readers", () => {
  test("an extension key named __proto__ is an own member of its slot", () => {
    const slot = accessRightsExtensions(JSON.parse('{ "x-acme-__proto__": { "polluted": true } }'));

    expect(Object.hasOwn(slot.acme ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(slot.acme)).toBe(Object.prototype);
  });

  test("an author's long text is cut in a message", () => {
    const quoted = accessRightsQuoted("x".repeat(200));

    expect(quoted).toHaveLength(80);
    expect(quoted.endsWith("...")).toBe(true);
    expect(accessRightsQuoted("path.taskId")).toBe("path.taskId");
  });
});
