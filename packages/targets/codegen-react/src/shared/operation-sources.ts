// The source parts every query library's module shares live in codegen-core, shared with the other front targets;
// the `"use client"` directive is React's own.
export {
  CONTRACT_ERROR_GUARD,
  constantCaseOf,
  type ErrorMember,
  keysObjectSource,
  METHOD_RESULT_TYPE,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  type PlanForms,
  planForms,
  type QueriesImports,
  REQUIRED_CALL_TYPE,
  resourceTypeSource,
  resourceUnion,
  resultExpression,
  settingsTypeSource,
} from "@seampact/codegen-core";

/** The directive that marks a module with hooks for a React Server Components toolchain. */
export const CLIENT_DIRECTIVE = '"use client";';
