import { describe, expect, test } from "vitest";
import {
  type DraftFixtureApi,
  draftFixtureApply,
  draftFixtureHalves,
} from "../../../pipeline/draft-fixture.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";
import {
  accessRightsReferenceDraft,
  accessRightsReferenceWorkspace,
  accessRightsRunReference,
} from "./test-support.js";

// The reference contract against its access delta: the members this half writes so far, the catalogues and each
// operation's `scopes`, `requires`, `fieldRights`, `filteredBy` and sort-key rights (the rest of the delta lands
// with the proofs). The expected sort keys are the after-tree keys with the delta applied.

const WRITTEN_CATALOGUES = ["rights", "rules", "scopes", "buckets"] as const;
const WRITTEN_OPERATION_MEMBERS = ["scopes", "requires", "fieldRights", "filteredBy"] as const;

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The delta's `paging` members only, by operation id.
function pagingOnly(operations: JsonValue | undefined): JsonObject {
  if (!isObject(operations)) throw new Error("the delta's operations are keyed by id");

  return Object.fromEntries(
    Object.entries(operations).flatMap(([id, members]) =>
      isObject(members) && members.paging !== undefined ? [[id, { paging: members.paging }]] : [],
    ),
  );
}

function rightsDelta(api: DraftFixtureApi): JsonObject {
  const half = draftFixtureHalves(api, "access-delta").find(
    (candidate) => candidate.half === "access.rights",
  );

  if (half === undefined) throw new Error(`the ${api} access delta has no access.rights half`);

  return half.members;
}

describe("access.rights matches the after-access fixture", () => {
  const workspace = accessRightsReferenceWorkspace();

  test.each<DraftFixtureApi>(["tasks", "tasksService"])(
    "%s: the catalogues and each operation's scopes, requires, field rights, filteredBy and sort keys",
    (api) => {
      const { draft, diagnostics } = accessRightsRunReference(workspace, api);
      const delta = rightsDelta(api);
      const after = accessRightsReferenceDraft(api);

      draftFixtureApply(after, { operations: { ...pagingOnly(delta.operations) } });

      expect(diagnostics).toEqual([]);

      for (const catalogue of WRITTEN_CATALOGUES)
        expect({ ...draft[catalogue] }, catalogue).toEqual(delta[catalogue]);

      const operations = delta.operations;

      if (!isObject(operations)) throw new Error("the delta's operations are keyed by id");
      expect(draft.operations.map((operation) => operation.id)).toEqual(Object.keys(operations));

      for (const operation of draft.operations) {
        const expected = operations[operation.id ?? ""];

        if (!isObject(expected)) throw new Error(`the delta has no operation ${operation.id}`);

        for (const member of WRITTEN_OPERATION_MEMBERS)
          expect(operation[member], `${operation.id}.${member}`).toEqual(expected[member]);

        expect(operation.paging, `${operation.id}.paging`).toEqual(
          after.operations.find((candidate) => candidate.id === operation.id)?.paging,
        );
      }
    },
  );
});
