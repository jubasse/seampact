// The API the code generators are written against: target definitions, link descriptors and refusals.
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
export type { Link, LinkLocation, LinkNeed, LinkOffer, LinkSet, Links } from "./links.js";
export type { Refusal, Refused } from "./refusal.js";
export type {
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
