import { referenceUnpagedList } from "@seampact/codegen-core/node-server/test-support";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { at, readGoldenIr } from "./golden-documents.test-support.js";

// A list declared `paging: none` is documented as a bare array with no cursor or limit parameter (ADR 0002 section 10).

it("documents a paging none list as an array of its items", () => {
  const ir = referenceUnpagedList("listChannels")(readGoldenIr("reference/tasks"), "tasks");
  const listChannels = ir.operations.find((operation) => operation.id === "listChannels");

  if (listChannels === undefined) throw new Error("the golden has no listChannels");

  const outcome = emitDocuments(ir);

  if (outcome.status !== "emitted") throw new Error(JSON.stringify(outcome));

  const document = parse(outcome.documents[0]?.text ?? "");
  const get = at(document, "paths", listChannels.path, "get");
  const media = listChannels.responses[0]?.media ?? "";
  const schema = at(get, "responses", "200", "content", media, "schema");

  expect(at(schema, "type")).toBe("array");
  expect(at(get, "x-seampact-paging")).toEqual({ none: true });
  expect(JSON.stringify(at(get, "parameters") ?? [])).not.toContain("cursor");
});
