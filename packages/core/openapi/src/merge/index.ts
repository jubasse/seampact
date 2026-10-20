// The merged document of a monorepo root: several apis' documents written as one, with each api's `prefix`, the
// identical elements kept once and every clash refused with its fix.

export {
  type MergeInput,
  type MergeOptions,
  type MergeOutcome,
  mergeDocuments,
} from "./merge-documents.js";
