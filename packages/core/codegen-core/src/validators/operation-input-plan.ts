import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type OperationId,
  type OperationInput,
  type Param,
} from "@seampact/spec/ir";
import { below, type IrLocation, operationLocation } from "../ir-location.js";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "../located-refusals.js";
import { requireName } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import type { ValidatorsLayout } from "./layout.js";
import {
  type FieldPlan,
  type ObjectPlan,
  type PlanContext,
  planTypeUse,
  type TypePlan,
} from "./type-plan.js";

// One validator per operation for the whole request, `{ path, query, headers, body }` after query decoding,
// each member present when the operation declares it: the one Standard Schema call of ADR 0012 "The check
// order" step 6. Path and query keys are wire names, header keys the lowercased wire names Node delivers. The
// query is always present, even without a declared param, so that an unknown query key is refused on every
// operation; path and headers strip unknown keys.
export interface OperationInputPlan {
  readonly operationId: OperationId;
  readonly exportName: string;
  readonly path: ObjectPlan | undefined;
  readonly query: ObjectPlan;
  readonly headers: ObjectPlan | undefined;
  readonly body: BodyPlan | undefined;
}

// The JSON body: the input schema's validator, extended with the body fields of rule proofs (ADR 0004
// section 7), which keep the schema's strictness.
export interface BodyPlan {
  readonly type: TypePlan;
  readonly proofFields: readonly FieldPlan[];
}

const JSON_MEDIA = "application/json";
const NOT_GENERATED_MEDIA: readonly string[] = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

export function planOperationInputs(
  ir: ContractIR,
  layout: ValidatorsLayout,
  refusals: Refusal[],
): OperationInputPlan[] {
  const context: PlanContext = { ir, layout, refusals, direction: "input" };

  return ir.operations.map((operation, index) =>
    operationInputPlan(operation, operationLocation(index, operation.id), context),
  );
}

function operationInputPlan(
  operation: Operation,
  location: IrLocation,
  context: PlanContext,
): OperationInputPlan {
  const paramsLocation = below(location, "params");
  const { path, query, header } = operation.params;

  const pathPlan =
    path.length > 0
      ? paramsObject("strip", path, (name) => name, below(paramsLocation, "path"), context)
      : undefined;

  refuseQueryForms(operation, below(location, "unknownQuery"), context.refusals);

  const queryPlan = paramsObject(
    "refuse",
    query,
    (name) => name,
    below(paramsLocation, "query"),
    context,
  );

  let headersPlan: ObjectPlan | undefined;

  if (header.length > 0) {
    const headerLocation = below(paramsLocation, "header");

    refuseDuplicateHeaders(header, headerLocation, context.refusals);
    headersPlan = paramsObject(
      "strip",
      header,
      (name) => name.toLowerCase(),
      headerLocation,
      context,
    );
  }

  const body =
    operation.input === undefined
      ? undefined
      : bodyPlan(operation.input, below(location, "input"), context);

  return {
    operationId: operation.id,
    exportName: requireName(context.layout.operationExportNames, operation.id),
    path: pathPlan,
    query: queryPlan,
    headers: headersPlan,
    body,
  };
}

// Undeclared query keys are refused (`unknownQuery: refuse`); ignoring them is not generated yet.
function refuseQueryForms(operation: Operation, location: IrLocation, refusals: Refusal[]): void {
  const unknownQuery = operation.unknownQuery;

  if (!isKnownVariant("UnknownQuery", unknownQuery)) {
    refusals.push(refuseUnknownValueAt(below(location, "policy"), unknownQuery.policy));

    return;
  }

  if (unknownQuery.policy === "ignore") {
    refusals.push(
      refuseNotGeneratedYet(
        "unknownQuery.ignore",
        "Ignoring unknown query keys",
        below(location, "policy"),
      ),
    );
  }
}

function paramsObject(
  unknownKeys: ObjectPlan["unknownKeys"],
  params: readonly Param[],
  keyOf: (wireName: string) => string,
  location: IrLocation,
  context: PlanContext,
): ObjectPlan {
  const fields = params.map((param, index): FieldPlan => {
    const paramLocation = below(location, index);

    if (param.default !== undefined) {
      context.refusals.push(
        refuseNotGeneratedYet(
          "param.default",
          "A parameter default",
          below(paramLocation, "default"),
        ),
      );
    }

    return {
      key: keyOf(param.name),
      type: planTypeUse(param.type, below(paramLocation, "type"), context),
      optional: !param.required,
    };
  });

  return { unknownKeys, fields };
}

function refuseDuplicateHeaders(
  headers: readonly Param[],
  location: IrLocation,
  refusals: Refusal[],
): void {
  const seen = new Set<string>();

  headers.forEach((header, index) => {
    const key = header.name.toLowerCase();

    if (seen.has(key)) {
      refusals.push(
        refuseInconsistentIr(
          "header.name.duplicate",
          `The header '${header.name}' is declared twice, compared without regard to case`,
          below(location, index, "name"),
        ),
      );
    }

    seen.add(key);
  });
}

function bodyPlan(input: OperationInput, location: IrLocation, context: PlanContext): BodyPlan {
  if (input.media !== JSON_MEDIA) {
    const mediaLocation = below(location, "media");

    context.refusals.push(
      NOT_GENERATED_MEDIA.includes(input.media)
        ? refuseNotGeneratedYet("input.media", `A '${input.media}' body`, mediaLocation)
        : refuseUnknownValueAt(mediaLocation, input.media),
    );

    return { type: { kind: "refused" }, proofFields: [] };
  }

  const type = planTypeUse(input.schema, below(location, "schema"), context);

  if (input.proofs === undefined || input.proofs.length === 0) return { type, proofFields: [] };

  if (input.schema.kind !== "ref") {
    context.refusals.push(
      refuseNotGeneratedYet(
        "input.proofs",
        "Proof fields beside a body that is not an object schema",
        below(location, "proofs"),
      ),
    );

    return { type: { kind: "refused" }, proofFields: [] };
  }

  const proofFields = input.proofs.map(
    (proof, index): FieldPlan => ({
      key: proof.name,
      type: planTypeUse(proof.schema, below(location, "proofs", index, "schema"), context),
      optional: false,
    }),
  );

  return { type, proofFields };
}
