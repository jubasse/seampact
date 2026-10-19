import { describe, expect, test } from "vitest";
import { findIrSensitiveReaches } from "./sensitive-field.js";

const SECRET_USE = { kind: "scalar", type: "string", refinements: {}, sensitive: true };
const PLAIN_USE = { kind: "scalar", type: "string", refinements: {} };

describe("finding the sensitive values a response carries", () => {
  test("a schema reached through a property and again as a body is reported for each response", () => {
    const schemas = {
      SecretKeys: { kind: "map", keys: SECRET_USE, values: PLAIN_USE },
      Holder: {
        kind: "object",
        properties: [
          { name: "keys", sensitive: false, type: { kind: "ref", schema: "SecretKeys" } },
        ],
      },
    };
    const responses = [
      { body: { kind: "ref", schema: "Holder" } },
      { body: { kind: "ref", schema: "SecretKeys" } },
    ];

    expect(findIrSensitiveReaches(responses, schemas)).toEqual([
      { place: "mapKey", response: 0, schema: "SecretKeys" },
      { place: "mapKey", response: 1, schema: "SecretKeys" },
    ]);
  });
});
