// The API the code generators are written against: target definitions, link descriptors, refusals, and the
// steps around a target's generate (IR support and link checks, header, formatting, file writer).
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
  ValidatorsDescriptor,
} from "./descriptors.js";
export { importSpecifier } from "./import-specifier.js";
export type { Link, LinkLocation, LinkNeeds, LinkOffers, LinkSet, Links } from "./links.js";
export type { Refusal, Refused } from "./refusal.js";
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
