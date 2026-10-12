// ADR 0007: cross-language naming. The language-neutral vectors live in
// `@seampact/spec/naming/vectors.json`; every implementation runs the whole file.

export {
  canonicalId,
  identifier,
  type OperationIdCase,
  operationId,
  type Style,
  styleOf,
} from "./identifier.js";
export { isReserved, type Language } from "./reserved.js";
export { deriveName, type Name, ROLES, type Role, suffixWords } from "./roles.js";
export { type NameSource, type SegmentsResult, segmentsOf, splitName } from "./split.js";
