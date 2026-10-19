// The API the code generators are written against: target definitions, link descriptors, refusals, and the
// steps around a target's generate (IR support and link checks, header, formatting, file writer), and the
// helpers targets share (IR locations, located refusals, planned names, property keys).
export { apiIndexSource, type IndexedModule } from "./api-index.js";
export { defineTarget } from "./define-target.js";
export type {
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
export { type GenerateWarning, warnLeftToHandler } from "./generate-warning.js";
export { importSpecifier } from "./import-specifier.js";
export { below, type IrLocation, operationLocation, schemaLocation } from "./ir-location.js";
export type { Link, LinkLocation, LinkNeeds, LinkOffers, LinkSet, Links } from "./links.js";
export {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "./located-refusals.js";
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
} from "./target.js";
export { refuseUnknownValue } from "./unknown-value.js";
export { type WriteOutcome, writeGeneratedFiles } from "./writer.js";
