import { describe, expect, test } from "vitest";
import { type DraftFixtureApi, draftFixtureHalves } from "../../../pipeline/draft-fixture.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";
import { accessRightsReferenceWorkspace, accessRightsRunReference } from "./test-support.js";

// The reference contract against its access delta: the members this half writes so far, the catalogues and each
// operation's `scopes` and `requires` (the rest of the delta lands with field rights and proofs).

const WRITTEN_CATALOGUES = ["rights", "rules", "scopes", "buckets"] as const;
const WRITTEN_OPERATION_MEMBERS = ["scopes", "requires"] as const;

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    "%s: the catalogues and each operation's scopes and requires",
    (api) => {
      const { draft, diagnostics } = accessRightsRunReference(workspace, api);
      const delta = rightsDelta(api);
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
      }
    },
  );
});
