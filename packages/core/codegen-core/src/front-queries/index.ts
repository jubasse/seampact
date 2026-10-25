// The framework-neutral query plan the front targets render (ADR 0021): per operation its form, export names, key,
// resource, call options and next-page rule, the front runtime each front target copies into its output, and the
// query module sources the TypeScript front targets share (plain fetch and TanStack Query factories, and the parts of
// the plain fetch hooks and composables).

export { refuseUnsupportedClientErrorStyle } from "./client-error-style.js";
export {
  AS_ERROR_SOURCE,
  callerOptionsParameter,
  cellsMutationSource,
  isRetryableSource,
  MUTATE_OUTCOME_TYPE,
  mutationCallerOptionsSource,
  type ReactiveCells,
  retryCheckSource,
} from "./fetch-mode-sources.js";
export { type FetchQueriesOptions, fetchQueriesModuleSource } from "./fetch-queries-module.js";
export { FRONT_RUNTIME_MODULE, frontRuntimeFile } from "./front-runtime-file.js";
export {
  NEXT_PAGE_EVIDENCE,
  type NextPageEvidence,
  type NextPageRule,
  type RequestMember,
} from "./next-page-rule.js";
export {
  CONTRACT_ERROR_GUARD,
  constantCase,
  constantCaseOf,
  type ErrorMember,
  type FrontErrors,
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
} from "./operation-sources.js";
export {
  type FrontQueryOptions,
  type FrontQueryOptionsSpec,
  parseFrontQueryOptions,
  type SwitchSettings,
  switchValue,
} from "./query-options.js";
export {
  planQueries,
  type QueryForm,
  type QueryNames,
  type QueryOperation,
  type QueryPlan,
  type QueryPlanOutcome,
  type QueryPlanSettings,
} from "./query-plan.js";
export {
  type TanstackAdapter,
  type TanstackQueriesOptions,
  tanstackQueriesModuleSource,
} from "./tanstack-queries-module.js";
