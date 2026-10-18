import { below, type IrLocation, refuseInconsistentIr, requireName } from "@seampact/codegen-core";
import type { Operation } from "@seampact/spec/ir";
import { REFUSED_TYPE, schemaTypeReference, type TypeContext } from "./type-expression.js";

// The union of the error codes the operation answers: the status from the `errors` registry, and `params` when
// the registry entry names a params schema.
export function operationErrorsDeclaration(
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const variants = operation.errors.map((error, index) => {
    const errorLocation = below(location, "errors", index);

    const declaration = Object.hasOwn(context.ir.errors, error.code)
      ? context.ir.errors[error.code]
      : undefined;

    if (declaration === undefined) {
      context.refusals.push(
        refuseInconsistentIr(
          "error.code.undeclared",
          `The error code '${error.code}' is not in the errors registry`,
          below(errorLocation, "code"),
        ),
      );

      return REFUSED_TYPE;
    }

    const members = [`status: ${declaration.http.status};`, `code: ${JSON.stringify(error.code)};`];

    if (declaration.params !== undefined) {
      const paramsLocation = below({ member: "" }, "errors", error.code, "params");

      members.push(`params: ${schemaTypeReference(declaration.params, paramsLocation, context)};`);
    }

    return `{ ${members.join(" ")} }`;
  });

  const typeName = requireName(context.layout.operationTypeNames, operation.id).errors;

  return `export type ${typeName} = ${variants.length === 0 ? "never" : variants.join(" | ")};`;
}
