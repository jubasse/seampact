import { describe, expect, test } from "vitest";
import {
  type DraftFixtureApi,
  draftFixture,
  draftFixtureApply,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
import { createDraftValidator } from "../../../pipeline/draft-schema.js";
import type { JsonObject } from "../../../raw-tree.js";
import {
  accessIdentityCataloguesRun,
  accessIdentityReference,
  accessIdentityRun,
} from "./test-support.js";

const APIS: readonly DraftFixtureApi[] = ["tasks", "tasksService"];
const CATALOGUES = ["schemes", "headers", "identities"] as const;

// The access.identity members of the access delta, as the fixture writes them.
function deltaOf(api: DraftFixtureApi): JsonObject {
  const half = draftFixtureHalves(api, "access-delta").find(
    (item) => item.half === "access.identity",
  );
  if (half === undefined) throw new Error(`the access delta of ${api} has no access.identity`);
  return half.members;
}

describe("access.identity catalogues", () => {
  test.each(APIS)("the catalogues of %s match the access delta", (api) => {
    const contract = accessIdentityReference(api);
    const { draft, diagnostics } = accessIdentityRun(
      contract,
      draftFixture(api, "after-tree"),
      draftFixtureSchemaService(api),
    );

    expect(diagnostics).toEqual([]);
    const delta = deltaOf(api);
    for (const catalogue of CATALOGUES) expect({ ...draft[catalogue] }).toEqual(delta[catalogue]);
  });

  test.each(APIS)("access.identity matches the after-access fixture (%s)", (api) => {
    const { draft, diagnostics } = accessIdentityRun(
      accessIdentityReference(api),
      draftFixture(api, "after-tree"),
      draftFixtureSchemaService(api),
    );

    expect(diagnostics).toEqual([]);
    const expected = draftFixture(api, "after-tree");
    draftFixtureApply(expected, deltaOf(api));
    expect(draft).toEqual(expected);
  });

  test("the catalogues of the lane fixture fit the draft form", () => {
    const { draft, diagnostics } = accessIdentityCataloguesRun();
    expect(diagnostics).toEqual([]);
    expect(createDraftValidator().validate(draft)).toMatchObject({ valid: true });
  });
});
