import { posix } from "node:path";
import type { Refusal } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { SCHEMAS_MODULE, type TypesLayout } from "./layout.js";
import type { TypeContext } from "./type-expression.js";

// The namespace an operation module imports the schemas module under; generated type names are PascalCase, so
// none can take it.
const SCHEMAS_NAMESPACE = "schemas";

// The context of an operation module: named types are read through the schemas namespace, imported only when
// the module uses one.
export function operationModuleContext(
  ir: ContractIR,
  layout: TypesLayout,
  refusals: Refusal[],
): { context: TypeContext; importLines(fromModule: string): string[] } {
  let isNamespaceUsed = false;

  const context: TypeContext = {
    ir,
    layout,
    refusals,
    referToNamedType(typeName) {
      isNamespaceUsed = true;

      return `${SCHEMAS_NAMESPACE}.${typeName}`;
    },
  };

  function importLines(fromModule: string): string[] {
    if (!isNamespaceUsed) return [];

    const specifier = posix.relative(posix.dirname(fromModule), SCHEMAS_MODULE);
    const dotted = specifier.startsWith("../") ? specifier : `./${specifier}`;

    return [`import type * as ${SCHEMAS_NAMESPACE} from "${dotted}.js";`];
  }

  return { context, importLines };
}
