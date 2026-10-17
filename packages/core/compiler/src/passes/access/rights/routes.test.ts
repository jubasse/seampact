import { describe, expect, test } from "vitest";
import { draftFixtureSchemaService } from "../../../pipeline/draft-fixture.js";
import {
  accessRightsApiOf,
  accessRightsReferenceDraft,
  accessRightsReferenceWorkspace,
  accessRightsRunOn,
} from "./test-support.js";

describe("routes read the access access.identity wrote", () => {
  test("an operation that is not a relay route and has no access is an internal error", () => {
    const workspace = accessRightsReferenceWorkspace();
    const draft = accessRightsReferenceDraft("tasks");
    const [first] = draft.operations;

    if (first === undefined) throw new Error("the reference draft has no operation");
    delete first.access;

    expect(() =>
      accessRightsRunOn(
        accessRightsApiOf(workspace, "tasks"),
        workspace,
        draft,
        draftFixtureSchemaService("tasks"),
      ),
    ).toThrow(`access.identity wrote no access on operation ${first.id}`);
  });
});
