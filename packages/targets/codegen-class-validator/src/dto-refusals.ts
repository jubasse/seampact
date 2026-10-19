import {
  below,
  type IrLocation,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
  schemaLocation,
} from "@seampact/codegen-core";
import { type ContractIR, isKnownVariant, type Param, type TypeUse } from "@seampact/spec/ir";

// The forms a DTO class cannot hold, beyond those every validators target refuses: a member named after a
// member of `Object.prototype` (class-transformer skips or misplaces it, and `constructor` is no field name), and
// a list of lists, whose inner items no decorator reaches.
export function refuseDtoForms(ir: ContractIR): Refusal[] {
  const refusals: Refusal[] = [];

  for (const [schemaId, schema] of Object.entries(ir.schemas)) {
    if (!isKnownVariant("Schema", schema) || schema.kind !== "object") continue;

    schema.properties.forEach((property, index) => {
      const location = below(schemaLocation(schemaId), "properties", index);

      refuseMemberName(property.name, below(location, "name"), refusals);
      refuseListsOfLists(property.type, below(location, "type"), refusals);
    });
  }

  ir.operations.forEach((operation, index) => {
    const location = operationLocation(index, operation.id);
    const { path, query, header } = operation.params;

    refuseParams(path, below(location, "params", "path"), (name) => name, refusals);
    refuseParams(query, below(location, "params", "query"), (name) => name, refusals);
    refuseParams(
      header,
      below(location, "params", "header"),
      (name) => name.toLowerCase(),
      refusals,
    );

    const input = operation.input;

    if (input === undefined) return;

    const inputLocation = below(location, "input");

    refuseListsOfLists(input.schema, below(inputLocation, "schema"), refusals);

    (input.proofs ?? []).forEach((proof, proofIndex) => {
      const proofLocation = below(inputLocation, "proofs", proofIndex);

      refuseMemberName(proof.name, below(proofLocation, "name"), refusals);
      refuseListsOfLists(proof.schema, below(proofLocation, "schema"), refusals);
    });
  });

  return refusals;
}

function refuseParams(
  params: readonly Param[],
  location: IrLocation,
  keyOf: (wireName: string) => string,
  refusals: Refusal[],
): void {
  params.forEach((param, index) => {
    refuseMemberName(keyOf(param.name), below(location, index, "name"), refusals);
    refuseListsOfLists(param.type, below(location, index, "type"), refusals);
  });
}

function refuseMemberName(name: string, location: IrLocation, refusals: Refusal[]): void {
  if (!Object.hasOwn(Object.prototype, name)) return;

  refusals.push(
    refuseNotGeneratedYet("dto.memberName", `A member named '${name}' in a DTO class`, location),
  );
}

function refuseListsOfLists(typeUse: TypeUse, location: IrLocation, refusals: Refusal[]): void {
  if (!isKnownVariant("TypeUse", typeUse) || typeUse.kind !== "array") return;

  const itemsLocation = below(location, "items");

  if (isKnownVariant("TypeUse", typeUse.items) && typeUse.items.kind === "array") {
    refusals.push(refuseNotGeneratedYet("dto.listOfLists", "A list of lists", itemsLocation));
  }

  refuseListsOfLists(typeUse.items, itemsLocation, refusals);
}
