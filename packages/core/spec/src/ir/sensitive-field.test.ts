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

  test("reaches come in the order the properties are written, nested ones between their neighbours", () => {
    const schemas = {
      Inner: { kind: "object", properties: [{ name: "b", sensitive: true, type: PLAIN_USE }] },
      Outer: {
        kind: "object",
        properties: [
          { name: "a", sensitive: true, type: PLAIN_USE },
          { name: "inner", sensitive: false, type: { kind: "ref", schema: "Inner" } },
          { name: "c", sensitive: true, type: PLAIN_USE },
        ],
      },
    };

    expect(
      findIrSensitiveReaches([{ body: { kind: "ref", schema: "Outer" } }], schemas).map(
        (reach) => reach.place === "field" && `${reach.schema}.${reach.property}`,
      ),
    ).toEqual(["Outer.a", "Inner.b", "Outer.c"]);
  });

  test("a chain of schemas longer than the call stack is walked to its end", () => {
    const LINKS = 20_000;
    const schemas: Record<string, unknown> = {};

    for (let index = 0; index < LINKS; index++)
      schemas[`Link${index}`] = {
        kind: "object",
        properties: [
          index === LINKS - 1
            ? { name: "secret", sensitive: true, type: PLAIN_USE }
            : { name: "next", sensitive: false, type: { kind: "ref", schema: `Link${index + 1}` } },
        ],
      };

    expect(findIrSensitiveReaches([{ body: { kind: "ref", schema: "Link0" } }], schemas)).toEqual([
      { place: "field", response: 0, schema: `Link${LINKS - 1}`, property: "secret" },
    ]);
  });
});
