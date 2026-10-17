import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { DraftIR } from "../../../pipeline/seam.js";
import type { AccessRightsRule } from "./report.js";
import {
  accessRightsApiOf,
  accessRightsListPaging,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// Every rule of access.rights, from the refused fixtures, each at its layer and pointer; each diagnostic resolves
// through the side table, its related locations too.
const REFUSED_FIXTURES = [
  "catalogues-refused",
  "refused",
  "guest",
  "service",
  "fields-refused",
  "proofs-refused",
] as const;

// What tree.nodes does not write yet, set before access.rights runs: the list paging of `fields-refused`.
const AFTER_TREE: Partial<Record<(typeof REFUSED_FIXTURES)[number], (draft: DraftIR) => void>> = {
  "fields-refused": (draft) =>
    accessRightsListPaging(draft, {
      operation: "listCrates",
      sortable: "/surfaces/app/routes/crates/ops/list/sortable",
      keys: ["weight"],
    }),
};

const REFUSED: Record<(typeof REFUSED_FIXTURES)[number], [AccessRightsRule, string, string][]> = {
  "catalogues-refused": [
    ["right-pattern", "api", "/rights/Tasks"],
    ["right-name", "api", "/rights/tasks.code"],
    ["right-pattern", "api", "/rights/*"],
    ["right-name", "api", "/rights/*"],
    ["right-subject", "api", "/rights/tasks.own/subject/scope"],
    ["proof-schema", "api", "/rules/stepUp/proof"],
    ["scope-within", "api", "/scopes/team/within"],
    ["scope-within", "api", "/scopes/left/within"],
    ["bucket-key", "api", "/buckets/wide/key/0"],
    ["bucket-window", "api", "/buckets/forever/window"],
  ],
  refused: [
    ["scope-unknown", "api", "/surfaces/app/routes/shops/member/scopes/till"],
    ["scope-nesting", "api", "/surfaces/app/routes/shops/member/scopes/shop"],
    ["scope-twice", "api", "/surfaces/app/routes/shops/member/scopes/aisle"],
    ["pack-right", "pack:odd", "/derive/1/declareRight"],
    ["pack-template", "pack:odd", "/derive/0/require/right"],
    ["requirement-target", "pack:odd", "/derive/0/require/right"],
    [
      "requirement-entry",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/0",
    ],
    [
      "requirement-target",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/1/right",
    ],
    [
      "requirement-params",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/2/params",
    ],
    [
      "requirement-params",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/3/params",
    ],
    [
      "requirement-bucket",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/4",
    ],
    [
      "requirement-subject",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/5/subject",
    ],
    [
      "requirement-twice",
      "api",
      "/surfaces/app/routes/shops/member/routes/items/member/routes/restock/requires/7",
    ],
  ],
  guest: [["guest-right", "api", "/surfaces/app/routes/articles/member/routes/preview/requires/1"]],
  service: [["caller-right", "api", "/surfaces/maintenance/routes/reindex"]],
  "fields-refused": [
    ["field-right-position", "api", "/schemas/Manifest/properties/secret/restrictedTo"],
    ["field-right-target", "api", "/schemas/Crate/properties/label/restrictedTo"],
    ["field-right-params", "api", "/schemas/Crate/properties/seal/restrictedTo/params"],
    ["filtered-by", "api", "/surfaces/app/routes/crates/ops/list/filteredBy"],
    ["sort-key-right", "api", "/surfaces/app/routes/crates/ops/list/sortable/0/right"],
    ["field-right-subject", "api", "/surfaces/app/routes/crates/ops/create/input"],
    ["field-right-recursive", "api", "/schemas/Pallet"],
    ["field-right-conflict", "api", "/schemas/Pickup/properties/fee/restrictedTo"],
    ["field-right-limit", "api", "/surfaces/app/routes/stack"],
  ],
  "proofs-refused": [
    ["proof-name", "api", "/surfaces/app/routes/rename/requires/0"],
    ["bucket-key", "api", "/surfaces/app/routes/rename/requires/1"],
    ["proof-name", "api", "/surfaces/app/routes/lock/requires/1"],
    ["proof-input", "api", "/surfaces/app/routes/peek/requires/0"],
    ["proof-input", "api", "/surfaces/app/routes/tag/requires/0"],
    ["signed-input", "api", "/surfaces/hooks/routes/ping"],
  ],
};

const RULES = [
  "right-name",
  "right-pattern",
  "right-subject",
  "proof-schema",
  "proof-name",
  "proof-input",
  "signed-input",
  "scope-within",
  "bucket-key",
  "bucket-window",
  "scope-unknown",
  "scope-twice",
  "scope-nesting",
  "requirement-entry",
  "requirement-target",
  "requirement-params",
  "requirement-bucket",
  "requirement-subject",
  "requirement-twice",
  "guest-right",
  "caller-right",
  "pack-template",
  "pack-right",
  "field-right-target",
  "field-right-params",
  "field-right-subject",
  "field-right-recursive",
  "field-right-conflict",
  "field-right-position",
  "field-right-limit",
  "sort-key-right",
  "filtered-by",
] as const satisfies readonly AccessRightsRule[];

const RULE_PREFIX = "seampact/access/";

// Every rule of the union is listed, so a new rule needs a refused case here.
type Unlisted = Exclude<AccessRightsRule, (typeof RULES)[number]>;
const everyRuleListed: [Unlisted] extends [never] ? true : Unlisted = true;

describe("access.rights diagnostics are located", () => {
  test("every rule is reported by a refused fixture, located in the side table with a message and a fix", () => {
    expect(everyRuleListed).toBe(true);
    const reported = new Set<string>();

    for (const fixture of REFUSED_FIXTURES) {
      const workspace = accessRightsLoadFixture(fixture);
      const locations = accessRightsApiOf(workspace).locations;
      const { diagnostics } = accessRightsRunContract(workspace, AFTER_TREE[fixture]);

      expect(
        diagnostics.map(({ rule, origin }) => [
          rule.replace(RULE_PREFIX, ""),
          origin.layer,
          origin.pointer,
        ]),
        fixture,
      ).toEqual(REFUSED[fixture]);

      for (const diagnostic of diagnostics) {
        reported.add(diagnostic.rule);
        expect(diagnostic.severity).toBe("error");
        expect(diagnostic.message).not.toBe("");
        expect(diagnostic.fix).not.toBe("");

        for (const origin of [diagnostic.origin, ...diagnostic.related.map((item) => item.origin)])
          expect(Object.hasOwn(locations, diagnosticLocationKey(origin)), origin.pointer).toBe(
            true,
          );
      }
    }

    expect([...reported].sort()).toEqual(RULES.map((rule) => `${RULE_PREFIX}${rule}`).sort());
  });
});
