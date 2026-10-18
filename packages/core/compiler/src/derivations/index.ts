// The derivation table and the derivation roles of ADR 0006 sections 5 and 6, held as data.

export { derivationCopy } from "./freeze.js";
export type {
  DerivationDatumRequired,
  DerivationIssueLocation,
  DerivationRole,
  DerivationRoleDatum,
  DerivationRoleName,
} from "./roles.js";
export {
  DERIVATION_EMPTY_BODY_SCHEMA_ID,
  DERIVATION_ISSUE_SCHEMA_ID,
  derivationCoreSchemaIds,
  derivationIssueLocations,
  derivationIssueMembers,
  derivationParamsSchemaId,
  derivationRoleOf,
  derivationRoles,
} from "./roles.js";
export type { DerivationRoles, DerivationRow } from "./table.js";
export { derivationRowOf, derivationTable, isDerivationId } from "./table.js";
