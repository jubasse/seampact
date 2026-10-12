import { describe, expect, test } from "vitest";
import { formatSchemaJson } from "./json.js";
import { AUTHORING_FILES, authoringSchemaFileName, authoringSchemas } from "./schemas.js";
import { authoringAjv, schemaId } from "./test-ajv.js";

describe("metaschema", () => {
  const ajv = authoringAjv();
  test.each(AUTHORING_FILES)("%s validates against the 2020-12 metaschema", (file) => {
    const valid = ajv.validateSchema(authoringSchemas()[file]);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });
  test.each(AUTHORING_FILES)("%s compiles in Ajv strict mode", (file) => {
    expect(() => ajv.getSchema(schemaId(file))).not.toThrow();
    expect(ajv.getSchema(schemaId(file))).toBeTypeOf("function");
  });
});

// The committed files are generated from the grammar modules: `vitest run -u` rewrites them.
describe("committed schemas", () => {
  test.each(AUTHORING_FILES)("%s matches the grammar", async (file) => {
    await expect(formatSchemaJson(authoringSchemas()[file])).toMatchFileSnapshot(
      `../../schemas/authoring/${authoringSchemaFileName(file)}`,
    );
  });
});
