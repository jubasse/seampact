import {
  below,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type NoOptions,
  type Refusal,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import {
  OPERATION_INPUT_MODULE,
  planValidatorsLayout,
  SCHEMA_MODULES,
  WIRE_CHECKS_MODULE,
} from "./layout.js";
import {
  type ModuleSource,
  moduleContents,
  modulePath,
  WIRE_CHECKS_SOURCE,
} from "./module-source.js";
import { operationInputModuleSource } from "./operation-input.js";
import { schemaModuleSource } from "./schema-module.js";

export const VALIDATORS_ARTEFACT = "validators";

export type ValidatorsArtefact = typeof VALIDATORS_ARTEFACT;

// The schema validators of each direction, the operation input validators and the code point counter they
// share, or every refusal at once: a form the slice does not use is refused by name, never approximated (A47).
export function generateValidators(
  input: GenerateInput<NoOptions, ValidatorsArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(VALIDATORS_ARTEFACT)) return { status: "generated", files: [] };

  const { ir } = input;
  const planned = planValidatorsLayout(ir);

  if (planned.status === "refused") return planned;

  const { layout } = planned;
  const refusals: Refusal[] = [];

  refuseApiForms(ir, refusals);

  const modules: { module: string; source: ModuleSource }[] = [
    { module: SCHEMA_MODULES.input, source: schemaModuleSource("input", ir, layout, refusals) },
    { module: SCHEMA_MODULES.output, source: schemaModuleSource("output", ir, layout, refusals) },
    { module: OPERATION_INPUT_MODULE, source: operationInputModuleSource(ir, layout, refusals) },
  ];

  if (refusals.length > 0) return { status: "refused", refusals: distinctRefusals(refusals) };

  const files: GeneratedFile[] = modules.flatMap(({ module, source }) => {
    const contents = moduleContents(module, source);

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  if (modules.some(({ source }) => source.wireChecks.size > 0)) {
    files.push({ path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE });
  }

  return { status: "generated", files };
}

// The enum forms that change a validator: open output enums, an enum's fallback and its code names.
function refuseApiForms(ir: ContractIR, refusals: Refusal[]): void {
  const outputEnums = ir.api.wire.outputEnums;
  const outputEnumsLocation = below({ member: "" }, "api", "wire", "outputEnums");

  if (outputEnums === "open") {
    refusals.push(
      refuseNotGeneratedYet("wire.outputEnums.open", "Open output enums", outputEnumsLocation),
    );
  } else if (outputEnums !== "enum") {
    refusals.push(refuseUnknownValueAt(outputEnumsLocation, outputEnums));
  }

  for (const [enumId, declaration] of Object.entries(ir.enums)) {
    const location = below({ member: "" }, "enums", enumId);

    if (declaration.codeNames !== undefined) {
      refusals.push(
        refuseNotGeneratedYet(
          "enum.codeNames",
          "An enum value's code name",
          below(location, "codeNames"),
        ),
      );
    }

    if (declaration.fallback !== undefined) {
      refusals.push(
        refuseNotGeneratedYet(
          "enum.fallback",
          "An open enum's fallback",
          below(location, "fallback"),
        ),
      );
    }
  }
}

// A schema used in both directions is written twice; its refusals are reported once.
function distinctRefusals(refusals: readonly Refusal[]): Refusal[] {
  const seen = new Set<string>();

  return refusals.filter((refusal) => {
    const key = `${refusal.code}\u0000${refusal.member ?? ""}`;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}
