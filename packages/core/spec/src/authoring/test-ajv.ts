// Test support: an Ajv 2020 instance in strict mode holding every authoring schema.
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemaFileName,
  authoringSchemas,
} from "./schemas.js";

// An absolute base for the relative `$ref`s between files; never fetched.
export const TEST_BASE_URI = "https://seampact.invalid/authoring/";

export function authoringAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true });
  const schemas = authoringSchemas();
  for (const file of AUTHORING_FILES) {
    ajv.addSchema({ ...schemas[file], $id: TEST_BASE_URI + authoringSchemaFileName(file) });
  }
  return ajv;
}

export function schemaId(file: AuthoringFile, pointer = ""): string {
  return `${TEST_BASE_URI}${authoringSchemaFileName(file)}${pointer ? `#${pointer}` : ""}`;
}
