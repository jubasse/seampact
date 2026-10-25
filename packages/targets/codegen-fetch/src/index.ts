// The fetch client target: one typed method per operation over the platform fetch, reading its request, success
// and error types from the `types` link and providing the `client` link the front targets consume.

// The client's reading of the contract, which the MSW target writes its mock answers from, so a mock answers only
// what the client reads.
export { typeNamespaceName } from "./client-module.js";
export { clientMethodName } from "./describe.js";
export {
  type OperationPlan,
  type PlannedOperation,
  planOperation,
  type SuccessPlan,
} from "./operation-plan.js";
export type { FactSource, PageFact } from "./success-reader.js";
export { target } from "./target.js";
export { refuseFormatForms } from "./wire-format.js";
