// The shared black-box HTTP suite (ADR 0015): the JSON case format and its shipped cases, the sample app's control
// routes and the script a sample app answers from, a runner against a base URL, the format readers of the pack profiles, the boot variants and their runner,
// and the report keyed by checklist id.
export {
  type BootAttempt,
  type BootRunOptions,
  bootFailures,
  runBootSuite,
} from "./boot-runner.js";
export {
  BOOT_STARTED_LINE,
  BOOT_VARIANT_ENV,
  BOOT_VARIANTS,
  type BootVariant,
  bootVariantOf,
  isBootVariant,
} from "./boot-variant.js";
export {
  CONTROL_ROUTE_PREFIX,
  HOOK_CALLS_ROUTE,
  LOG_LINES_ROUTE,
  loadScript,
  readHookCalls,
  readLogLines,
  SCRIPT_ROUTE,
} from "./control-routes.js";
export {
  type FormatReader,
  FormatReaderError,
  formatReaderOf,
  type ReadBody,
} from "./format-reader.js";
export { CASES_DIRECTORY, loadSuiteCases } from "./load-cases.js";
export type { SentRequest } from "./operation-match.js";
export { type PackProfile, packProfileName, packProfileOf } from "./pack-profile.js";
export { STRIPE_V1_SCHEME, signRequestBody } from "./request-signature.js";
export {
  authenticateHookName,
  type DecidePurpose,
  decideHookName,
  OVERRIDDEN_RIGHT,
  operationKey,
  overriddenDecideHookName,
  parseSampleAppScript,
  type SampleAppScript,
  SampleAppScriptError,
  type ScriptedAnswer,
  type ScriptedDecision,
  type ScriptedDenial,
  type ScriptedScope,
} from "./sample-app-script.js";
export {
  type BootExpectation,
  type CaptureSource,
  type HeaderExpectation,
  type JsonValue,
  parseSuiteCase,
  type RecordedHookCall,
  type RequestSignature,
  runsInProfile,
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
  PROFILE_CHECKS,
  SUITE_REPORT_FORMAT,
  type SuiteReport,
  type SuiteRun,
  suiteReportOf,
  writeSuiteReport,
} from "./suite-report.js";
export { runSuite, type SuiteCredentials, type SuiteRunOptions } from "./suite-runner.js";
