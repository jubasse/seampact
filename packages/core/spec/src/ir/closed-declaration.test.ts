import { expect, test } from "vitest";
import everyMember from "../../schemas/ir/examples/every-member.ir.json" with { type: "json" };
import { checkIrClosedDeclaration, type IrClosedDefinition } from "./closed-declaration.js";
import type { ContractIR, Enum as IrEnum } from "./types.generated.js";
import type * as IrWriter from "./types.writer.generated.js";
import { isKnownVariant } from "./unions.js";

const ir = (): ContractIR => structuredClone(everyMember) as ContractIR;

function present<T>(declaration: T | undefined, id: string): T {
  if (declaration === undefined) throw new Error(`every-member.ir.json has no ${id}`);

  return declaration;
}

const KNOWN: readonly { definition: IrClosedDefinition; member: keyof ContractIR; id: string }[] = [
  { definition: "Schema", member: "schemas", id: "Task" },
  { definition: "Schema", member: "schemas", id: "Labels" },
  { definition: "Schema", member: "schemas", id: "Notice" },
  { definition: "Enum", member: "enums", id: "Mirror" },
  { definition: "Scalar", member: "scalars", id: "money" },
  { definition: "WireFormat", member: "formats", id: "bare" },
  { definition: "ExtensionKeyDecl", member: "extensionKeys", id: "acme-owner" },
  { definition: "PagingStyle", member: "pagings", id: "cursor" },
  { definition: "Operation", member: "operations", id: "0" },
];

for (const { definition, member, id } of KNOWN) {
  test(`a known ${definition} passes and keeps its value (${id})`, () => {
    const declaration = (ir()[member] as Record<string, unknown>)[id];

    expect(checkIrClosedDeclaration(definition, declaration, `/${member}/${id}`)).toEqual({
      closed: declaration,
    });
    expect(checkIrClosedDeclaration(definition, declaration).closed).toBe(declaration);
  });
}

test("a read-only open declaration narrows to the writer type", () => {
  const declaration: Readonly<IrEnum> = present(ir().enums.Mirror, "Mirror");
  const check = checkIrClosedDeclaration("Enum", declaration);

  if (check.closed === undefined) throw new Error("Mirror holds an unknown");
  const written: IrWriter.Enum = check.closed;

  expect(written.id).toBe("Mirror");
});

test("an unknown schema kind is reported at its tag", () => {
  const schema = { ...ir().schemas.Task, kind: "tuple" };

  expect(checkIrClosedDeclaration("Schema", schema, "/schemas/Task")).toEqual({
    unknowns: [{ pointer: "/schemas/Task/kind", value: "tuple" }],
  });
});

test("an unknown enum value form is reported at its tag", () => {
  const enumeration = { ...ir().enums.Mirror, source: { kind: "registry", registry: "states" } };

  expect(checkIrClosedDeclaration("Enum", enumeration, "/enums/Mirror")).toEqual({
    unknowns: [{ pointer: "/enums/Mirror/source/kind", value: "registry" }],
  });
});

test("an unknown open string member is reported with its pointer", () => {
  const scalar = { ...ir().scalars.money, directions: ["input", "sideways"] };

  expect(checkIrClosedDeclaration("Scalar", scalar, "/scalars/money")).toEqual({
    unknowns: [{ pointer: "/scalars/money/directions/1", value: "sideways" }],
  });
});

test("an unknown use nested in a property is reported, every unknown at once", () => {
  const task = present(ir().schemas.Task, "Task");

  if (!isKnownVariant("Schema", task) || task.kind !== "object")
    throw new Error("Task is an object schema");
  const property = { ...task.properties[0], type: { kind: "set" } };
  const schema = { ...task, directions: ["both"], properties: [property] };

  expect(checkIrClosedDeclaration("Schema", schema, "/schemas/Task")).toEqual({
    unknowns: [
      { pointer: "/schemas/Task/directions/0", value: "both" },
      { pointer: "/schemas/Task/properties/0/type/kind", value: "set" },
    ],
  });
});

test("a member the schema does not know is reported at its pointer", () => {
  const schema = { ...ir().schemas.Task, "x-extra": 1 };

  expect(checkIrClosedDeclaration("Schema", schema, "/schemas/Task")).toEqual({
    unknowns: [{ pointer: "/schemas/Task/x-extra", value: "x-extra" }],
  });
});

test("a known TypeUse passes", () => {
  const type = { kind: "ref", schema: "Labels" };

  expect(checkIrClosedDeclaration("TypeUse", type, "/type")).toEqual({ closed: type });
});

test("an unknown variant nested in an operation is reported", () => {
  const operation = { ...ir().operations[0], unknownQuery: { policy: "ignore-all" } };

  expect(checkIrClosedDeclaration("Operation", operation, "/operations/0")).toEqual({
    unknowns: [{ pointer: "/operations/0/unknownQuery/policy", value: "ignore-all" }],
  });
});

test("an unknown TypeUse kind is reported at its tag", () => {
  expect(checkIrClosedDeclaration("TypeUse", { kind: "set" }, "/type")).toEqual({
    unknowns: [{ pointer: "/type/kind", value: "set" }],
  });
});

test("a missing or non-string union tag is reported, not returned closed", () => {
  const task = present(ir().schemas.Task, "Task");
  const { kind: _removed, ...withoutKind } = task;

  expect(checkIrClosedDeclaration("Schema", withoutKind, "/schemas/Task")).toEqual({
    unknowns: [{ pointer: "/schemas/Task/kind", value: "undefined" }],
  });
  expect(checkIrClosedDeclaration("Schema", { ...task, kind: 5 }, "/schemas/Task")).toEqual({
    unknowns: [{ pointer: "/schemas/Task/kind", value: "number" }],
  });
});

test("a non-string open-enum value is reported, not returned closed", () => {
  const scalar = { ...ir().scalars.money, directions: ["input", 7] };

  expect(checkIrClosedDeclaration("Scalar", scalar, "/scalars/money")).toEqual({
    unknowns: [{ pointer: "/scalars/money/directions/1", value: "number" }],
  });
});

test("a non-string open-enum value in an object position is reported by kind", () => {
  const scalar = { ...ir().scalars.money, directions: [{ deep: "x".repeat(500) }, null] };

  expect(checkIrClosedDeclaration("Scalar", scalar, "/scalars/money")).toEqual({
    unknowns: [
      { pointer: "/scalars/money/directions/0", value: "object" },
      { pointer: "/scalars/money/directions/1", value: "null" },
    ],
  });
});

test("an echoed unknown string is cut to a bound", () => {
  const long = "k".repeat(500);
  const check = checkIrClosedDeclaration("TypeUse", { kind: long }, "/type");

  expect(check.unknowns?.[0]?.value).toBe(`${"k".repeat(64)}...`);
});

test("an echoed unknown member name is cut to a bound", () => {
  const schema = { ...ir().schemas.Task, ["m".repeat(500)]: 1 };
  const [unknown] = checkIrClosedDeclaration("Schema", schema, "/schemas/Task").unknowns ?? [];

  expect(unknown).toEqual({
    pointer: `/schemas/Task/${"m".repeat(64)}...`,
    value: `${"m".repeat(64)}...`,
  });
});

test("an unknown member of a paging style is reported at its pointer", () => {
  const style = { ...ir().pagings.cursor, zzLater: true };

  expect(checkIrClosedDeclaration("PagingStyle", style, "/pagings/cursor")).toEqual({
    unknowns: [{ pointer: "/pagings/cursor/zzLater", value: "zzLater" }],
  });
});
