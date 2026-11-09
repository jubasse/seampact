import type { ContractIR, Operation } from "@seampact/spec/ir";
import type { ValidatorStyle } from "../descriptors.js";
import { type ImportSpecifierStyle, relativeModuleSpecifier } from "../import-specifier.js";
import { HANDLERS_MODULE, operationIdentifier } from "./server-types.js";

// The `InputRules` type of the routes module (ADR 0028 "Typed on Node"): for each operation and part with input, the
// library schema type of the api's validators over that part as its handler receives it, without the body proof
// fields. The registration's `inputRules` takes it, so a misspelt operation, a wrong part, a missing member or
// another library's schema does not compile. class-validator registers a class, checked on its members only.

const INPUT_RULES_EXPORT = "InputRules";
const HANDLER_INPUTS_EXPORT = "HandlerInputs";

/** The type's imports and declaration in the routes module. */
export interface InputRulesTypeSource {
  readonly imports: readonly string[];
  readonly declaration: readonly string[];
}

/** The type in the routes module; `validatorOf` gives the expression of an operation's input validator. */
export function inputRulesTypeSource(
  ir: ContractIR,
  runtimePackage: string,
  style: ValidatorStyle,
  fromFile: string,
  importStyle: ImportSpecifierStyle,
  validatorOf: (operation: Operation) => string | undefined,
): InputRulesTypeSource {
  const ruleType = (validator: string, part: string): string =>
    style === "class-validator"
      ? `InputRuleClass<${part}>`
      : `InputRuleSchema<typeof ${validator}, ${part}>`;

  const members = ir.operations.flatMap((operation) => {
    const validator = validatorOf(operation);
    const parts = partsWithInput(operation);

    if (validator === undefined || parts.length === 0) return [];

    const handlerInput = `${HANDLER_INPUTS_EXPORT}[${JSON.stringify(operationIdentifier(operation))}]`;
    const partMembers = parts.map(
      (part) =>
        `    readonly ${part}?: ${ruleType(validator, partType(operation, handlerInput, part))};`,
    );

    return [`  readonly ${JSON.stringify(operation.id)}?: {`, ...partMembers, "  };"];
  });

  return {
    imports: [
      `import type { ${style === "class-validator" ? "InputRuleClass" : "InputRuleSchema"} } from "${runtimePackage}";`,
      `import type { ${HANDLER_INPUTS_EXPORT} } from "${relativeModuleSpecifier(fromFile, HANDLERS_MODULE, importStyle)}";`,
    ],
    declaration: [
      "/** The app's own rules on each operation's input parts, in the library of the api's validators (step 8b). */",
      `export type ${INPUT_RULES_EXPORT} = {\n${members.join("\n")}\n};`,
    ],
  };
}

type InputPart = "path" | "query" | "headers" | "body";

function partsWithInput(operation: Operation): InputPart[] {
  return [
    ...(operation.params.path.length > 0 ? (["path"] as const) : []),
    ...(operation.params.query.length > 0 ? (["query"] as const) : []),
    ...(operation.params.header.length > 0 ? (["headers"] as const) : []),
    ...(operation.input === undefined ? [] : (["body"] as const)),
  ];
}

function partType(operation: Operation, handlerInput: string, part: InputPart): string {
  const type = `${handlerInput}[${JSON.stringify(part)}]`;
  const proofs = part === "body" ? (operation.input?.proofs ?? []) : [];

  if (proofs.length === 0) return type;

  return `Omit<${type}, ${proofs.map((proof) => JSON.stringify(proof.name)).join(" | ")}>`;
}
