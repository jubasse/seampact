import { createHmac, timingSafeEqual } from "node:crypto";
import type { Awaitable, SignatureTemplate, SignedTemplateRequest } from "@seampact/hooks";

/** The secrets currently valid for a key id: one, or several during a rotation. The helper never keeps them. */
export type SecretLookup = (keyId: string) => Awaitable<readonly (string | Uint8Array)[]>;

export interface VerifyTemplateSignatureOptions {
  /** The current time in milliseconds since the Unix epoch; `Date.now` when absent. */
  readonly now?: () => number;
}

/** Why a signature failed; the authenticate hook answers its declared 401 for each of them. */
export type SignatureFailure =
  | "no-secret"
  | "timestamp-missing"
  | "timestamp-malformed"
  | "timestamp-outside-tolerance"
  | "signature-mismatch";

export type SignatureVerification =
  | { readonly verified: true; readonly failure?: never }
  | { readonly verified: false; readonly failure: SignatureFailure };

/** The only MAC this helper computes; the IR enum is open, so another algorithm is refused by name. */
export const SUPPORTED_ALGORITHM = "hmac-sha256";

const HMAC_SHA256_BYTES = 32;
const TIMESTAMP_PLACEHOLDER = "{ts}";
const RAW_BODY_PLACEHOLDER = "{rawBody}";
const MILLISECONDS_PER_SECOND = 1000;
const UNIX_SECONDS = /^[0-9]+$/;
const HEX = /^(?:[0-9a-fA-F]{2})+$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Thrown when the scheme names an algorithm this helper does not compute: a contract it cannot verify. */
export class UnsupportedSignatureAlgorithmError extends Error {
  readonly code = "signature.algorithm.unsupported";

  constructor(readonly algorithm: string) {
    super(
      `The signature algorithm '${algorithm}' is not one @seampact/signed-webhooks computes; it computes '${SUPPORTED_ALGORITHM}'. Verify this scheme with 'verify: application', or update the helper to a release that computes it.`,
    );
  }
}

/** Thrown when the payload does not hold `{rawBody}` exactly once and `{ts}` at most once: a captured signature could pass with another body. */
export class SignaturePayloadInvalidError extends Error {
  readonly code = "signature.payload.invalid";

  constructor(readonly payload: string) {
    super(
      `The signed payload '${payload}' must hold {rawBody} exactly once and {ts} at most once, or a captured signature could pass with another body. Copy the payload of the hook's signature template.`,
    );
  }
}

/** Thrown when the payload signs `{ts}` and the scheme has no tolerance: a replay of any age would pass. */
export class SignatureToleranceMissingError extends Error {
  readonly code = "signature.tolerance.missing";

  constructor(readonly payload: string) {
    super(
      `The signed payload '${payload}' holds {ts} but the scheme has no tolerance, so a replayed request of any age would pass. Pass the tolerance of the hook's signature template as toleranceMs.`,
    );
  }
}

/** Thrown when the lookup returns an empty secret: anyone can compute a MAC with it, so the check fails closed. */
export class EmptySignatureSecretError extends Error {
  readonly code = "signature.secret.empty";

  constructor(readonly keyId: string) {
    super(
      `The secret looked up for the key '${keyId}' is empty, so any request could pass. Configure the secret (check the environment variable behind the lookup).`,
    );
  }
}

/**
 * Verifies a template-signed request (ADR 0013 "Where the verification happens"): rebuilds the signed payload
 * from the raw bytes, computes the MAC with each valid secret, compares it in constant time with each candidate,
 * then checks the timestamp against the tolerance in both directions.
 */
export async function verifyTemplateSignature(
  request: SignedTemplateRequest,
  lookupSecrets: SecretLookup,
  options: VerifyTemplateSignatureOptions = {},
): Promise<SignatureVerification> {
  const { template } = request;

  if (template.algorithm !== SUPPORTED_ALGORITHM) {
    throw new UnsupportedSignatureAlgorithmError(template.algorithm);
  }

  refuseInvalidPayload(template);

  const payload = signedPayload(template, request);

  if (payload === undefined) return failed("timestamp-missing");

  const secrets = await lookupSecrets(request.keyId);

  if (secrets.length === 0) return failed("no-secret");

  if (secrets.some((secret) => secret.length === 0))
    throw new EmptySignatureSecretError(request.keyId);

  const candidates = request.candidateSignatures.flatMap((candidate) => {
    const decoded = decodeCandidate(candidate, template.encoding);

    return decoded === undefined ? [] : [decoded];
  });

  if (!anySecretMatches(secrets, payload, candidates)) return failed("signature-mismatch");

  return timestampFailure(request, template, options) ?? { verified: true };
}

function occurrences(text: string, placeholder: string): number {
  return text.split(placeholder).length - 1;
}

function refuseInvalidPayload(template: SignatureTemplate): void {
  const timestampCount = occurrences(template.payload, TIMESTAMP_PLACEHOLDER);

  if (occurrences(template.payload, RAW_BODY_PLACEHOLDER) !== 1 || timestampCount > 1) {
    throw new SignaturePayloadInvalidError(template.payload);
  }

  if (timestampCount === 1 && template.toleranceMs === undefined) {
    throw new SignatureToleranceMissingError(template.payload);
  }
}

function failed(failure: SignatureFailure): SignatureVerification {
  return { verified: false, failure };
}

// The payload template with `{ts}` replaced by the timestamp text as received and `{rawBody}` by the raw bytes;
// undefined when the template signs a timestamp the request does not carry.
function signedPayload(
  template: SignatureTemplate,
  request: SignedTemplateRequest,
): Buffer | undefined {
  const [beforeBody = "", afterBody = ""] = template.payload.split(RAW_BODY_PLACEHOLDER);
  const signsTimestamp = template.payload.includes(TIMESTAMP_PLACEHOLDER);

  if (signsTimestamp && request.timestamp === undefined) return undefined;

  const fill = (text: string) => text.replace(TIMESTAMP_PLACEHOLDER, request.timestamp ?? "");

  return Buffer.concat([
    Buffer.from(fill(beforeBody), "utf8"),
    request.rawBody,
    Buffer.from(fill(afterBody), "utf8"),
  ]);
}

// A candidate that does not decode in the declared encoding, or decodes to the wrong length, never matches.
function decodeCandidate(
  candidate: string,
  encoding: SignatureTemplate["encoding"],
): Buffer | undefined {
  const pattern = encoding === "hex" ? HEX : BASE64;

  if (!pattern.test(candidate)) return undefined;

  const decoded = Buffer.from(candidate, encoding);

  return decoded.length === HMAC_SHA256_BYTES ? decoded : undefined;
}

// Every secret against every candidate, without stopping at the first match.
function anySecretMatches(
  secrets: readonly (string | Uint8Array)[],
  payload: Buffer,
  candidates: readonly Buffer[],
): boolean {
  let matched = false;

  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(payload).digest();

    for (const candidate of candidates) {
      if (timingSafeEqual(expected, candidate)) matched = true;
    }
  }

  return matched;
}

function timestampFailure(
  request: SignedTemplateRequest,
  template: SignatureTemplate,
  options: VerifyTemplateSignatureOptions,
): SignatureVerification | undefined {
  if (template.toleranceMs === undefined) return undefined;

  if (request.timestamp === undefined) return failed("timestamp-missing");

  if (!UNIX_SECONDS.test(request.timestamp)) return failed("timestamp-malformed");

  const signedAtMs = Number(request.timestamp) * MILLISECONDS_PER_SECOND;
  const nowMs = (options.now ?? Date.now)();

  if (Math.abs(nowMs - signedAtMs) > template.toleranceMs) {
    return failed("timestamp-outside-tolerance");
  }

  return undefined;
}
