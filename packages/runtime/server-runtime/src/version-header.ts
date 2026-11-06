// The version a write sends in a request header (grammar section 6), read before the input is validated: a missing
// or empty one answers the `preconditionRequired` role (428), never `schemaInvalid`. `If-Match` carries it as one
// entity tag, strong or weak (a compressing server or proxy weakens the tag it read, and the version is the same):
// `*` names no version and is missing too, and a list or a value that is no tag can match no version, so it answers
// the `preconditionFailed` role (412). The handler receives the version unquoted and compares it with the stored one.
import { roleError } from "./contract-error.js";
import { type ContractRequest, type ContractRoute, headerValues } from "./contract-route.js";

const PRECONDITION_REQUIRED_ROLE = "preconditionRequired";
const PRECONDITION_FAILED_ROLE = "preconditionFailed";
const ANY_ENTITY_TAG = "*";
const ENTITY_TAG = /^(?:W\/)?"([^"]*)"$/;

/**
 * The version an `If-Match` tag carries, undefined for another header source or none; throws the operation's 428
 * or 412 code when the version header is missing or can match no version.
 */
export function sentVersion(route: ContractRoute, request: ContractRequest): string | undefined {
  const versionHeader = route.versionHeader;

  if (versionHeader === undefined) return undefined;

  const values = headerValues(request.headers)[versionHeader.name] ?? [];
  const sent = values.join(", ").trim();

  if (sent === "") throw roleError(route, PRECONDITION_REQUIRED_ROLE);

  if (!versionHeader.entityTag) return undefined;

  if (sent === ANY_ENTITY_TAG) throw roleError(route, PRECONDITION_REQUIRED_ROLE);

  const version = ENTITY_TAG.exec(sent)?.[1];

  if (version === undefined) throw roleError(route, PRECONDITION_FAILED_ROLE);

  return version;
}
