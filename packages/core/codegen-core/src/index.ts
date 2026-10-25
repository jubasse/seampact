// The API the code generators are written against: target definitions, link descriptors, refusals, and the
// steps around a target's generate (IR support and link checks, header, formatting, file writer), and the
// helpers targets share (IR locations, located refusals, planned names, property keys, the front query plan).
export { apiIndexSource, type IndexedModule } from "./api-index.js";
export { type ClientFilledHeaders, clientFilledHeadersOf } from "./client-filled-headers.js";
export { compareCodeUnits } from "./code-unit-order.js";
export { defineTarget } from "./define-target.js";
export type {
  ClientDescriptor,
  ClientErrorStyle,
  ClientExports,
  ClientOperationExports,
  Descriptor,
  DescriptorByKind,
  DescriptorSet,
  ExportRef,
  LinkKind,
  LinkStyle,
  OperationTypeExports,
  OperationValidatorExports,
  ProvidedDescriptors,
  SchemaDirection,
  SchemaExports,
  TypesDescriptor,
  ValidatorStyle,
  ValidatorsDescriptor,
} from "./descriptors.js";
export {
  DEFAULT_FRAMEWORK_ROUTE_CHECK,
  DEFAULT_HOOK_BOOT_CHECK,
  type FrameworkRouteAllowance,
  type FrameworkRouteCheck,
  type HookBootCheck,
  type TunableBootCheck,
} from "./framework-route-check.js";
export {
  CONTRACT_ERROR_GUARD,
  constantCaseOf,
  type ErrorMember,
  type FetchQueriesOptions,
  FRONT_RUNTIME_MODULE,
  type FrontErrors,
  type FrontQueryOptions,
  type FrontQueryOptionsSpec,
  fetchQueriesModuleSource,
  frontRuntimeFile,
  keysObjectSource,
  METHOD_RESULT_TYPE,
  NEXT_PAGE_EVIDENCE,
  type NextPageEvidence,
  type NextPageRule,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  type PlanForms,
  parseFrontQueryOptions,
  planForms,
  planQueries,
  type QueriesImports,
  type QueryForm,
  type QueryNames,
  type QueryOperation,
  type QueryPlan,
  type QueryPlanOutcome,
  type QueryPlanSettings,
  REQUIRED_CALL_TYPE,
  type RequestMember,
  refuseUnsupportedClientErrorStyle,
  resourceTypeSource,
  resourceUnion,
  resultExpression,
  type SwitchSettings,
  settingsTypeSource,
  switchValue,
  type TanstackAdapter,
  type TanstackQueriesOptions,
  tanstackQueriesModuleSource,
} from "./front-queries/index.js";
export { type GenerateWarning, warnLeftToHandler } from "./generate-warning.js";
export { importSpecifier, relativeModuleSpecifier } from "./import-specifier.js";
export { below, type IrLocation, operationLocation, schemaLocation } from "./ir-location.js";
export type { Link, LinkLocation, LinkNeeds, LinkOffers, LinkSet, Links } from "./links.js";
export {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "./located-refusals.js";
export { type ManifestRead, readManifest } from "./manifest.js";
export type {
  NativeDocsDocument,
  NativeDocsJson,
  NativeDocsJsonObject,
} from "./native-docs-document.js";
export { type NoOptions, parseNoOptions } from "./no-options.js";
export {
  declaredTypeIdentifier,
  ExportNames,
  requireName,
  typeScriptIdentifier,
} from "./planned-names.js";
export { propertyKey } from "./property-key.js";
export { type Refusal, type Refused, withoutRepeats } from "./refusal.js";
export type {
  AnyTargetMetadata,
  ArtefactDeclaration,
  DescribeOutcome,
  FormatterParser,
  GeneratedFile,
  GenerateInput,
  GenerateOutcome,
  GenerateRequest,
  ParseOptionsOutcome,
  SourceFormat,
  Target,
  TargetDefinition,
  TargetMetadata,
  TargetRole,
} from "./target.js";
export { TARGET_ROLES } from "./target.js";
export { refuseUnknownValue } from "./unknown-value.js";
export {
  commitGeneratedWrite,
  type HandEditPolicy,
  type PlannedWrite,
  type PlanWriteOptions,
  type PlanWriteOutcome,
  planGeneratedWrite,
  type WriteOutcome,
  type WrittenFiles,
  writeGeneratedFiles,
} from "./writer.js";
