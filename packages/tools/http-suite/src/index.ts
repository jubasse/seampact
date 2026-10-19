// The shared black-box HTTP suite (ADR 0015): the JSON case format and its shipped cases, the sample app's control
// routes and the script a sample app answers from, a runner against a base URL and the report keyed by checklist id.
export {
  CONTROL_ROUTE_PREFIX,
  HOOK_CALLS_ROUTE,
  LOG_LINES_ROUTE,
  loadScript,
  readHookCalls,
  readLogLines,
  SCRIPT_ROUTE,
} from "./control-routes.js";
export { CASES_DIRECTORY, loadSuiteCases } from "./load-cases.js";
export { STRIPE_V1_SCHEME, signRequestBody } from "./request-signature.js";
export {
  authenticateHookName,
  type DecidePurpose,
  decideHookName,
  operationKey,
  parseSampleAppScript,
  type SampleAppScript,
  SampleAppScriptError,
  type ScriptedAnswer,
  type ScriptedDecision,
  type ScriptedDenial,
  type ScriptedScope,
} from "./sample-app-script.js";
export {
  type CaptureSource,
  type HeaderExpectation,
  type JsonValue,
  parseSuiteCase,
  type RecordedHookCall,
  type RequestSignature,
  type StepExpectation,
  type StepRequest,
  type SuiteCase,
  SuiteCaseError,
  type SuiteProfile,
  type SuiteStep,
} from "./suite-case.js";
export {
  type CaseOutcome,
  type CaseResult,
  type CheckResult,
  SUITE_REPORT_FORMAT,
  type SuiteReport,
  suiteReportOf,
  writeSuiteReport,
} from "./suite-report.js";
export { runSuite, type SuiteCredentials, type SuiteRunOptions } from "./suite-runner.js";
