import { describe, expect, test } from "vitest";
import { apiIndexSource } from "./api-index.js";
import { relativeModuleSpecifier } from "./import-specifier.js";

describe("a relative import specifier", () => {
  test("ends in .js by default", () => {
    expect(relativeModuleSpecifier("tasks/routes.ts", "validators/tasks/index")).toBe(
      "../validators/tasks/index.js",
    );
    expect(relativeModuleSpecifier("hono", "handlers")).toBe("./handlers.js");
  });

  test("has no extension in the extensionless style", () => {
    expect(
      relativeModuleSpecifier("tasks/routes.ts", "validators/tasks/index", "extensionless"),
    ).toBe("../validators/tasks/index");
    expect(relativeModuleSpecifier("next", "handlers", "extensionless")).toBe("./handlers");
  });
});

describe("the api index", () => {
  test("re-exports its modules in the asked style", () => {
    expect(apiIndexSource([{ module: "next" }, { module: "handlers" }], "extensionless")).toBe(
      'export * from "./next";\nexport * from "./handlers";\n',
    );
    expect(apiIndexSource([{ module: "hono" }])).toBe('export * from "./hono.js";\n');
  });
});
