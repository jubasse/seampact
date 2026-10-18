// Parses a template scheme's signature header (ADR 0013 "Test vectors") into the parts the authenticate hook
// receives. Copied into the generated tree as is.

export interface ParsedSignatureHeader {
  /** The `{ts}` text as received; absent when the format has no `{ts}`. */
  readonly timestamp?: string;
  /** Every `{sig}` value, still encoded, in header order. */
  readonly candidateSignatures: readonly string[];
}

const TIMESTAMP_SLOT = "{ts}";
const SIGNATURE_SLOT = "{sig}";
const DIGITS = /^[0-9]+$/;
const PAIR_SEPARATOR = ",";
const NAME_SEPARATOR = "=";
const PAIR_FORMAT = /^[A-Za-z0-9_-]+=\{(ts|sig)\}(,[A-Za-z0-9_-]+=\{(ts|sig)\})*$/;

/**
 * The header parsed by its format (`t={ts},v1={sig}`): comma-separated `name=value` pairs, each named slot read
 * from its pair; a repeated signature pair adds a candidate. Undefined for a malformed or missing header: no
 * signature, a timestamp that is not digits, a repeated timestamp, or a pair that is not `name=value`.
 */
export function parseSignatureHeader(
  format: string,
  header: string | undefined,
): ParsedSignatureHeader | undefined {
  if (header === undefined || header.trim() === "") return undefined;

  if (!PAIR_FORMAT.test(format)) return parsePrefixedHeader(format, header);

  const slots = slotNames(format);

  if (slots === undefined) return undefined;

  let timestamp: string | undefined;
  const candidateSignatures: string[] = [];

  for (const pair of header.split(PAIR_SEPARATOR)) {
    const separator = pair.indexOf(NAME_SEPARATOR);

    if (separator <= 0) return undefined;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    if (name === slots.timestamp) {
      if (timestamp !== undefined || !DIGITS.test(value)) return undefined;

      timestamp = value;
    } else if (name === slots.signature) {
      if (value === "") return undefined;

      candidateSignatures.push(value);
    }
  }

  if (candidateSignatures.length === 0) return undefined;

  if (slots.timestamp !== undefined && timestamp === undefined) return undefined;

  return timestamp === undefined ? { candidateSignatures } : { timestamp, candidateSignatures };
}

// The pair names carrying `{ts}` and `{sig}` in a format such as `t={ts},v1={sig}`.
function slotNames(format: string): { timestamp?: string; signature: string } | undefined {
  let timestamp: string | undefined;
  let signature: string | undefined;

  for (const pair of format.split(PAIR_SEPARATOR)) {
    const [name, slot] = pair.split(NAME_SEPARATOR, 2);

    if (name === undefined || slot === undefined) return undefined;

    if (slot === TIMESTAMP_SLOT) timestamp = name;
    else if (slot === SIGNATURE_SLOT) signature = name;
  }

  if (signature === undefined) return undefined;

  return timestamp === undefined ? { signature } : { timestamp, signature };
}

// A literal prefix followed by `{sig}`, as `sha256={sig}`: the signature is what follows the prefix.
function parsePrefixedHeader(format: string, header: string): ParsedSignatureHeader | undefined {
  if (!format.endsWith(SIGNATURE_SLOT)) return undefined;

  const prefix = format.slice(0, -SIGNATURE_SLOT.length);

  if (!header.startsWith(prefix) || header.length === prefix.length) return undefined;

  return { candidateSignatures: [header.slice(prefix.length)] };
}
