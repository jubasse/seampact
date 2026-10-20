import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { at, readGoldenIr } from "./golden-documents.test-support.js";

// `$each` in a paging style's body (ADR 0002 section 13): an array of `$as` read with the slots of the record.

describe("a paging style that maps its records with $each", () => {
  it("writes an array under the member `$collection` names, each item merging the record with its link", () => {
    const ir = readGoldenIr("pack-hal/tasks");
    const listChannels = ir.operations.find((operation) => operation.id === "listChannels");

    if (listChannels === undefined) throw new Error("the golden has no listChannels");

    const outcome = emitDocuments(ir);
    const document = outcome.status === "emitted" ? parse(outcome.documents[0]?.text ?? "") : {};
    const media = listChannels.responses[0]?.media ?? "";
    const page = at(
      document,
      "paths",
      listChannels.path,
      "get",
      "responses",
      "200",
      "content",
      media,
      "schema",
    );
    const channels = at(page, "properties", "_embedded", "properties", "channels");

    expect(outcome.status).toBe("emitted");
    expect(at(channels, "type")).toBe("array");
    expect(JSON.stringify(at(channels, "items"))).toContain("allOf");
  });
});
