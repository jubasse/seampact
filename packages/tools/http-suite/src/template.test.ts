import { describe, expect, test } from "vitest";
import { TemplateError, TemplateScope } from "./template.js";

const MILLISECONDS_PER_MINUTE = 60_000;

describe("TemplateScope", () => {
  test("fills a filler of the given length and a deadline before now", () => {
    const scope = new TemplateScope({});
    const before = Date.now();
    const deadline = Date.parse(scope.fillText("{{deadline:-60000}}"));

    expect(scope.fill("{{filler:5}}")).toBe("aaaaa");
    expect(deadline).toBeLessThanOrEqual(before - MILLISECONDS_PER_MINUTE + 1000);
    expect(deadline).toBeGreaterThan(before - 2 * MILLISECONDS_PER_MINUTE);
  });

  test.each([
    ["a filler without a length", "{{filler:many}}", "needs a whole number of characters"],
    ["an unknown name", "{{nobody}}", "filler:<length>"],
  ])("refuses %s", (_case, text, message) => {
    const scope = new TemplateScope({});

    expect(() => scope.fillText(text)).toThrow(TemplateError);
    expect(() => scope.fillText(text)).toThrow(message);
  });
});
