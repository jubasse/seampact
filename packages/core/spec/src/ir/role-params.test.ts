import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import declarations from "../../schemas/ir/declarations.schema.json" with { type: "json" };
import everyMember from "../../schemas/ir/examples/every-member.ir.json" with { type: "json" };
import vectors from "../../vectors/ir/role-params.json" with { type: "json" };
import { checkIrInvariants } from "./invariants.js";
import { IR_SCHEMA_BASE } from "./schemas.js";
import { createAjv, mutateAt } from "./test-support.js";

const TEMPLATE_SCHEMA = `${IR_SCHEMA_BASE}formats.schema.json#/$defs/Template`;
const ROLE_SCHEMA = `${IR_SCHEMA_BASE}declarations.schema.json#/$defs/ErrorRole`;
// A code of every-member that declares params: the refused template is bound there.
const BINDING_WITH_PARAMS = "/operations/2/errors/0/roles/0";

const irValidator = createAjv("strict");
const paramsValidator = new Ajv2020();
const isTemplate = irValidator.getSchema(TEMPLATE_SCHEMA);
const knownRoles: string[] = declarations.$defs.ErrorRole["x-seampact-known"];

test("role-params vectors are valid templates with expected params valid against their schema, and the refused case breaks ir.error.role-params", () => {
  expect(irValidator.getSchema(ROLE_SCHEMA)).toBeDefined();
  expect(new Set(vectors.cases.map((vector) => vector.id)).size).toBe(vectors.cases.length);

  for (const vector of vectors.cases) {
    expect(isTemplate?.(vector.template), vector.id).toBe(true);
    expect(knownRoles, vector.id).toContain(vector.role);

    if ("refused" in vector) {
      const ir = mutateAt(everyMember, BINDING_WITH_PARAMS, (binding) => {
        binding.params = vector.template;
      });
      const violated = checkIrInvariants(ir).map((violation) => violation.id);

      expect(violated, vector.id).toContain(vector.refused);
      continue;
    }

    const isParams = paramsValidator.compile(vector.paramsSchema);

    expect(
      isParams(vector.expected),
      `${vector.id}: ${paramsValidator.errorsText(isParams.errors)}`,
    ).toBe(true);
  }
});
