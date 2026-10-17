import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { AccessRightsRule } from "./report.js";
import {
  accessRightsApiOf,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// Every rule of access.rights, from the refused fixtures, each at its layer and pointer; each diagnostic resolves
// through the side table, its related locations too.
const REFUSED_FIXTURES = ["catalogues-refused", "refused", "guest", "service"] as const;

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
};

const RULES = [
  "right-name",
  "right-pattern",
  "right-subject",
  "proof-schema",
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
      const { diagnostics } = accessRightsRunContract(workspace);
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
