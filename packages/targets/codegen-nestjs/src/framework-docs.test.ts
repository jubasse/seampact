import { describe, expect, test } from "vitest";
import { target } from "./index.js";

// NestJS's own document comes from the app's `SwaggerModule.setup` call, which the target does not write, so it
// knows no switch the CLI could write for `frameworkDocs: off`: the CLI refuses the key with this fix instead.

describe("the NestJS target and frameworkDocs", () => {
  test("frameworkDocs off is refused with the fix that removes the SwaggerModule.setup call", () => {
    expect(target.metadata.role).toBe("server");
    expect(target.metadata.frameworkDocsOffFix).toBe("remove the `SwaggerModule.setup` call");
  });
});
