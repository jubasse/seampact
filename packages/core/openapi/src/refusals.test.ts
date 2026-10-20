import { type ContractIR, isKnownVariant, type Operation } from "@seampact/spec/ir";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { at, readGoldenIr } from "./golden-documents.test-support.js";

// What the emitter leaves out or refuses by name when an IR member has no place in a document, each on a golden IR
// changed in the one member under test.

function operationOf(ir: ContractIR, operationId: string): Operation {
  const found = ir.operations.find((operation) => operation.id === operationId);

  if (found === undefined) throw new Error(`no operation ${operationId}`);

  return found;
}

function refusalCodes(ir: ContractIR): string[] {
  const outcome = emitDocuments(ir);

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

describe("credentials stay with their security schemes", () => {
  it("writes no query parameter for a query credential", () => {
    const ir = readGoldenIr("reference/tasks");
    const getTask = operationOf(ir, "getTask");
    const credential = getTask.params.header.find(
      (param) => param.derivedFrom?.derivation === "identity.authenticate",
    );

    if (credential === undefined) throw new Error("getTask reads its credential from a header");

    getTask.params.header = getTask.params.header.filter((param) => param !== credential);
    getTask.params.query.push({ ...credential, name: "access_token" });

    const outcome = emitDocuments(ir);
    const document = outcome.status === "emitted" ? parse(outcome.documents[0]?.text ?? "") : {};
    const parameters = at(document, "paths", getTask.path, getTask.method, "parameters");

    expect(outcome.status).toBe("emitted");
    expect(JSON.stringify(parameters)).not.toContain("access_token");
  });
});

describe("refuses by name what no document can state", () => {
  it("refuses an undeclared paging style", () => {
    const ir = readGoldenIr("reference/tasks");
    const paging = operationOf(ir, "listTasks").paging;

    if (paging === undefined) throw new Error("listTasks is paged");

    paging.style = "undeclared";

    expect(refusalCodes(ir)).toContain("openapi.paging.style");
  });

  it("refuses a value source in a named place without its name", () => {
    const ir = readGoldenIr("reference/tasks");
    const scope = operationOf(ir, "getTask").scopes[0];

    if (scope === undefined) throw new Error("getTask has a scope");

    delete scope.source.name;

    expect(refusalCodes(ir)).toContain("openapi.value-source.name");
  });

  it("refuses a proof it cannot mark as a password", () => {
    const ir = readGoldenIr("reference/tasks");
    const proof = operationOf(ir, "purgeTask").input?.proofs?.[0];

    if (proof === undefined || !isKnownVariant("TypeUse", proof.schema)) {
      throw new Error("purgeTask has a proof");
    }

    proof.schema.nullable = true;

    expect(refusalCodes(ir)).toContain("openapi.sensitive.shape.unsupported");
  });

  it("refuses a form field named with brackets", () => {
    const ir = readGoldenIr("bodies/notes");
    const tags = operationOf(ir, "feedbackNotes").input?.fields?.find(
      (field) => field.name === "tags",
    );

    if (tags === undefined) throw new Error("feedbackNotes has a tags field");

    tags.wire.brackets = true;

    expect(refusalCodes(ir)).toContain("openapi.input.brackets.unsupported");
  });

  it("refuses an unknown response shape as an unknown value", () => {
    const ir = readGoldenIr("reference/tasks");
    const response = operationOf(ir, "getTask").responses[0];

    if (response === undefined) throw new Error("getTask has a response");

    response.shape = "stream";

    expect(refusalCodes(ir)).toContain("ir.value.unknown");
  });
});
