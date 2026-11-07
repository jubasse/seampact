// The idempotency digests: the claim's fixed-size key and the request fingerprint a retry must match, the same text
// on every server target (Spring Boot's `Digests` included).
import { isPlainObject } from "./plain-object.js";
import { sha256Hex } from "./sha256.js";

const AUTHORIZATION_HEADER = "authorization";

/** What the fingerprint reads of a route's access; a `ContractRoute`'s access entry is one. */
export type FingerprintAccess =
  | { readonly kind: "public" }
  | {
      readonly kind: "identity";
      readonly credentials: readonly {
        readonly in: "bearer" | "cookie" | "header";
        readonly name?: string;
      }[];
      readonly signed?: { readonly header: string };
      readonly csrfHeader?: string;
    };

/** What the fingerprint reads of a route; a `ContractRoute` is one. */
export interface FingerprintRoute {
  readonly method: string;
  readonly path: string;
  readonly access: FingerprintAccess;
}

/** The SHA-256 hex of the parts as JSON, object members sorted by name. */
export function idempotencyDigest(parts: readonly unknown[]): Promise<string> {
  return sha256Hex(JSON.stringify(parts, sortedMembers));
}

/**
 * The digest a retry under the same key must match: the method, the contract path and the validated input, its
 * headers cut to `fingerprintHeaders`, the author-declared header params and a union tag in lower case (the route's
 * idempotency entry). Any other header param the compiler derives (a trace id, a deadline, the key) changes on a retry.
 */
export function idempotencyFingerprint(
  route: FingerprintRoute,
  input: unknown,
  fingerprintHeaders: readonly string[],
): Promise<string> {
  const credentials = credentialHeaders(route.access);
  const counted = new Set(fingerprintHeaders.filter((name) => !credentials.has(name)));

  // The validated input holds the decoded path params, so an equivalent encoding of the path is the same request.
  return idempotencyDigest([route.method, route.path, withOnlyHeaders(input, counted)]);
}

// The headers carrying a credential, lower case: a retry after a token or session refresh is the same request
// (ADR 0012 "Target obligations"), and a fingerprint never digests a credential.
function credentialHeaders(access: FingerprintAccess): ReadonlySet<string> {
  if (access.kind === "public") return new Set();

  const names = access.credentials.flatMap((source) => {
    if (source.in === "bearer") return [AUTHORIZATION_HEADER];

    return source.in === "header" && source.name !== undefined ? [source.name.toLowerCase()] : [];
  });

  if (access.csrfHeader !== undefined) names.push(access.csrfHeader.toLowerCase());

  if (access.signed !== undefined) names.push(access.signed.header.toLowerCase());

  return new Set(names);
}

function withOnlyHeaders(input: unknown, names: ReadonlySet<string>): unknown {
  if (!isPlainObject(input) || !isPlainObject(input.headers)) return input;

  const kept = Object.entries(input.headers).filter(([name]) => names.has(name));

  return { ...input, headers: Object.fromEntries(kept) };
}

// Object members sorted by name, so the same request with its members reordered digests the same.
function sortedMembers(_name: string, value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((name) => [name, value[name]]),
  );
}
