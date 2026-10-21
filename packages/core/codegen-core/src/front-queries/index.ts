// The framework-neutral query plan the front targets render (ADR 0021): per operation its form, export names, key,
// resource, call options and next-page rule, and the front runtime each front target copies into its output.
export { FRONT_RUNTIME_MODULE, frontRuntimeFile } from "./front-runtime-file.js";
export {
  NEXT_PAGE_EVIDENCE,
  type NextPageEvidence,
  type NextPageRule,
  type RequestMember,
} from "./next-page-rule.js";
export {
  planQueries,
  type QueryForm,
  type QueryNames,
  type QueryOperation,
  type QueryPlan,
  type QueryPlanOutcome,
  type QueryPlanSettings,
} from "./query-plan.js";
