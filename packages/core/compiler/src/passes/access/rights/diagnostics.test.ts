import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { AccessRightsRule } from "./report.js";
import {
  accessRightsApiOf,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// Every rule of access.rights, from the refused fixtures; each diagnostic resolves through the side table, its
// related locations too.
const REFUSED_FIXTURES = ["catalogues-refused", "refused", "guest", "service"] as const;

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

    expect([...reported].sort()).toEqual(RULES.map((rule) => `seampact/access/${rule}`).sort());
  });
});
