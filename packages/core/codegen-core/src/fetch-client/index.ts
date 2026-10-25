// The fetch client's reading of the contract (ADR 0021): the per-operation request and success plan, the page and
// payload readers, the wire format forms it refuses, and the type namespace names. The fetch client renders it and
// the MSW target writes its mock answers from it, so a mock answers only what the client reads.

export {
  type OperationPlan,
  type PlannedOperation,
  planOperation,
  type SuccessPlan,
} from "./operation-plan.js";
export type { FactSource, PageFact } from "./success-reader.js";
export { typeNamespaceName } from "./type-namespace.js";
export { refuseFormatForms } from "./wire-format.js";
