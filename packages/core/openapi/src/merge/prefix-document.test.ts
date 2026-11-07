import { describe, expect, it } from "vitest";
import { prefixDocument } from "./prefix-document.js";

describe("prefix document", () => {
  it("renames references and keys, and leaves a data string naming a component as it is", () => {
    const document = {
      openapi: "3.1.0",
      paths: {},
      components: {
        schemas: {
          Task: {
            type: "string",
            examples: ["#/components/schemas/Task"],
            default: "#/components/schemas/Task",
          },
          Holder: { $ref: "#/components/schemas/Task", description: "#/components/schemas/Task" },
        },
      },
    };

    expect(prefixDocument(document, "p").components).toEqual({
      schemas: {
        "p.Task": {
          type: "string",
          examples: ["#/components/schemas/Task"],
          default: "#/components/schemas/Task",
        },
        "p.Holder": {
          $ref: "#/components/schemas/p.Task",
          description: "#/components/schemas/Task",
        },
      },
    });
  });
});
