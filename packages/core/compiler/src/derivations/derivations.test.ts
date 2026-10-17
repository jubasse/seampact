import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IR_SCHEMA_DOCUMENTS, type IrWriter, KNOWN_VALUES_KEYWORD } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { pipelineHalves } from "../pipeline/halves.js";
import { derivationCopy } from "./freeze.js";
import { derivationIssueMembers, derivationRoleOf, derivationRoles } from "./roles.js";
import { derivationRowOf, derivationTable, isDerivationId } from "./table.js";

const ADR = readFileSync(
  fileURLToPath(new URL("../../../../../docs/adr/0006-compiler-pass-pipeline.md", import.meta.url)),
  "utf8",
);

// The body rows of the first markdown table after `heading`, each split into its cells.
function tableAfter(heading: string): string[][] {
  const lines = ADR.slice(ADR.indexOf(heading)).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

const ticked = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");

const adrDerivations = tableAfter("### 5. The derivation table").map(
  ([id = "", , , role = ""]) => ({
    id: ticked(id)[0],
    roles: role === "declared" || role === "none" ? role : ticked(role),
  }),
);

const adrRoles = tableAfter("### 6. Roles and their default codes").map(
  ([role = "", code = "", status = "", nature = "", data = ""]) => ({
    role: ticked(role)[0],
    defaultCode: ticked(code)[0],
    status: Number(status),
    nature,
    data:
      data === "none"
        ? []
        : [
            {
              name: ticked(data)[0],
              required: data.includes("(required)")
                ? "always"
                : /required (on|when)/.test(data)
                  ? "conditional"
                  : "never",
            },
          ],
  }),
);

describe("derivation table", () => {
  test("derivation table matches ADR 0006", () => {
    expect(adrDerivations.length).toBeGreaterThan(40);
    expect(derivationTable.map(({ id, roles }) => ({ id, roles }))).toEqual(adrDerivations);
  });

  test("every row has its owner halves", () => {
    const halves: readonly (string | null)[] = [...pipelineHalves, null];
    for (const row of derivationTable) {
      expect(halves, row.id).toContain(row.wire);
      // Every row derives something: codes (derive.errors writes them), or another element.
      expect(row.roles !== "none" || row.wire !== null, row.id).toBe(true);
    }
  });

  test("every role named in section 5 exists in section 6", () => {
    for (const row of derivationTable)
      if (Array.isArray(row.roles))
        for (const role of row.roles)
          expect(derivationRoleOf(role), `${row.id}: ${role}`).toBeDefined();
  });

  test("isDerivationId accepts the table ids and pack entries", () => {
    for (const row of derivationTable)
      expect(isDerivationId(row.id), row.id).toBe(row.id !== "pack.<pack>.<entry>");
    expect(isDerivationId("pack.@seampact/pack-crud-rights.owner")).toBe(true);
    expect(isDerivationId("pack.house.v2.audit")).toBe(true);
    expect(derivationRowOf("pack.house.audit")?.wire).toBe("access.rights");
    for (const id of ["pack.house", "pack..x", "pack.house.", "body", "", "pack.<pack>.<entry>"])
      expect(isDerivationId(id), id).toBe(false);
  });
});

describe("roles", () => {
  test("roles match ADR 0006", () => {
    expect(adrRoles.length).toBe(20);
    expect(
      derivationRoles.map(({ role, defaultCode, status, nature, data }) => ({
        role,
        defaultCode,
        status,
        nature,
        data: data.map(({ name, required }) => ({ name, required })),
      })),
    ).toEqual(adrRoles);
  });

  test("the roles are the IR's known error roles", () => {
    const definitions = new Map<string, unknown>();
    for (const document of IR_SCHEMA_DOCUMENTS)
      for (const [name, def] of Object.entries((document.$defs ?? {}) as Record<string, unknown>))
        definitions.set(name, def);
    const errorRole = definitions.get("ErrorRole") as Record<string, unknown> | undefined;
    const known = errorRole?.[KNOWN_VALUES_KEYWORD];
    expect([...derivationRoles.map((entry) => entry.role)].sort()).toEqual(
      [...(Array.isArray(known) ? known : [])].sort(),
    );
  });

  test("a conditional datum states its condition, and only it", () => {
    for (const role of derivationRoles)
      for (const datum of role.data)
        expect(datum.condition !== undefined, `${role.role}.${datum.name}`).toBe(
          datum.required === "conditional",
        );
  });
});

// Every object reachable from `value`, each time it is reached.
function objectsOf(value: unknown, found: object[] = []): object[] {
  if (typeof value !== "object" || value === null) return found;
  found.push(value);
  for (const item of Object.values(value)) objectsOf(item, found);
  return found;
}

describe("derivation data", () => {
  test("the data is deep-frozen and shares no object", () => {
    const objects = objectsOf([derivationTable, derivationRoles, derivationIssueMembers]).slice(1);
    for (const object of objects)
      expect(Object.isFrozen(object), JSON.stringify(object)).toBe(true);
    expect(new Set(objects).size, "an object reached twice").toBe(objects.length);
  });

  test("a copy of a role's type use is writable and leaves the data unchanged", () => {
    const datum = derivationRoleOf("payloadTooLarge")?.data[0];
    if (datum === undefined) throw new Error("no datum");
    const copy = derivationCopy<IrWriter.TypeUse>(datum.type);
    expect(copy).toEqual(datum.type);
    if (copy.kind !== "scalar") throw new Error("no scalar use");
    copy.refinements.minimum = "1";
    expect(datum.type).toMatchObject({ refinements: { minimum: "0" } });
  });

  test("an issue's `in` is one of path, query, header, body", () => {
    const where = derivationIssueMembers.find((member) => member.name === "in");
    const pattern = where?.type.kind === "scalar" ? where.type.refinements.pattern : undefined;
    expect(pattern?.source).toBe("^(?:path|query|header|body)$");
    expect(pattern?.normalized).toBe(pattern?.source);
  });
});
