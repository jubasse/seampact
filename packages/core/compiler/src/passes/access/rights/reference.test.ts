import { describe, expect, test } from "vitest";
import { type DraftFixtureApi, draftFixture } from "../../../pipeline/draft-fixture.js";
import {
  accessRightsReferenceWorkspace,
  accessRightsRunReference,
  accessRightsRunReferenceHalves,
} from "./test-support.js";

// The reference contract against its after-access fixture: the after-tree draft with both halves of the access
// delta applied. Each run writes every member of the delta and changes nothing else.

const REFERENCE_APIS: DraftFixtureApi[] = ["tasks", "tasksService"];

describe("access.rights matches the after-access fixture", () => {
  const workspace = accessRightsReferenceWorkspace();

  test.each(REFERENCE_APIS)(
    "%s: access.rights on the after-tree draft plus access.identity's members",
    (api) => {
      const { draft, diagnostics } = accessRightsRunReference(workspace, api);

      expect(diagnostics).toEqual([]);
      expect(draft).toEqual(draftFixture(api, "after-access"));
    },
  );
});

describe("access halves on the reference contract", () => {
  const workspace = accessRightsReferenceWorkspace();

  test.each(REFERENCE_APIS)("%s: the real access.identity, then access.rights, guarded", (api) => {
    const { draft, diagnostics } = accessRightsRunReferenceHalves(workspace, api);

    expect(diagnostics).toEqual([]);
    expect(draft).toEqual(draftFixture(api, "after-access"));
  });
});
