import { describe, expect, test } from "vitest";
import { accessRightsAt, accessRightsExtensions } from "./read.js";
import { accessRightsQuoted } from "./report.js";

describe("raw tree readers", () => {
  test("a list index is read in canonical form only", () => {
    const root = { list: ["first", "second"] };

    expect(accessRightsAt(root, "/list/1")).toBe("second");
    expect(accessRightsAt(root, "/list/")).toBeUndefined();
    expect(accessRightsAt(root, "/list/01")).toBeUndefined();
    expect(accessRightsAt(root, "/list/-1")).toBeUndefined();
  });

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
