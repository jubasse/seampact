import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { at, readGoldenIr } from "./golden-documents.test-support.js";

// A paging style's own body follows the style's `absent`, not the format's (ADR 0002 section 14).

describe("a paging style whose absent is null", () => {
  it("documents an absent link as a required nullable string", () => {
    const ir = readGoldenIr("pack-laravel/tasks");
    const listTasks = ir.operations.find((operation) => operation.id === "listTasks");

    if (listTasks === undefined) throw new Error("the golden has no listTasks");

    const outcome = emitDocuments(ir);
    const document = outcome.status === "emitted" ? parse(outcome.documents[0]?.text ?? "") : {};
    const media = listTasks.responses[0]?.media ?? "";
    const links = at(
      document,
      "paths",
      listTasks.path,
      "get",
      "responses",
      "200",
      "content",
      media,
      "schema",
      "properties",
      "links",
    );

    expect(outcome.status).toBe("emitted");
    expect(at(links, "required")).toEqual(["first", "last", "prev", "next"]);
    expect(JSON.stringify(at(links, "properties", "prev"))).toContain("null");
  });
});
