// The boundary's own compression of its replies, for a framework whose compression plugin never sees them (Fastify's
// `reply.hijack()` skips `@fastify/compress`): a body at or above the threshold is encoded in the coding the client
// prefers among br, gzip and deflate, its ETag made weak, and `Vary: Accept-Encoding` added. Copied into the generated
// tree of the Node server targets as is.
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import type { ContractReply } from "./contract-error.js";
import {
  CONTENT_ENCODING_HEADER,
  ETAG_HEADER,
  VARY_HEADER,
  WEAK_ETAG_PREFIX,
} from "./reply-headers.js";

/** The smallest body the boundary compresses, the default threshold of `@fastify/compress`. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

const ACCEPT_ENCODING = "Accept-Encoding";
const ANY_CODING = "*";
const QUALITY_PARAMETER = /^q=([0-9.]+)$/i;
const FULL_QUALITY = 1;

// In the server's order of preference, which breaks a tie between equal client qualities.
const ENCODERS = [
  ["br", brotliCompressSync],
  ["gzip", gzipSync],
  ["deflate", deflateSync],
] as const;

type Encoder = (typeof ENCODERS)[number];

/** The reply encoded for a client's `Accept-Encoding`, or as is when it is small, encoded or not accepted. */
export function compressedReply(
  reply: ContractReply,
  acceptEncoding: string | undefined,
): ContractReply {
  if (reply.body.byteLength < COMPRESSION_THRESHOLD_BYTES) return reply;

  if (reply.headers.some(([name]) => name.toLowerCase() === CONTENT_ENCODING_HEADER)) return reply;

  const headers: (readonly [string, string])[] = [...reply.headers, [VARY_HEADER, ACCEPT_ENCODING]];
  const encoder = preferredEncoder(acceptEncoding);

  if (encoder === undefined) return { ...reply, headers };

  const [coding, encode] = encoder;

  return {
    status: reply.status,
    headers: [...headers.map(weakEtag), [CONTENT_ENCODING_HEADER, coding]],
    body: new Uint8Array(encode(reply.body)),
  };
}

// The encoded body is another representation of the same content, so its validator is weak.
function weakEtag([name, value]: readonly [string, string]): readonly [string, string] {
  if (name.toLowerCase() !== ETAG_HEADER || value.startsWith(WEAK_ETAG_PREFIX))
    return [name, value];

  return [name, `${WEAK_ETAG_PREFIX}${value}`];
}

// The supported coding with the highest quality above zero; `*` stands for any coding the header does not name.
function preferredEncoder(acceptEncoding: string | undefined): Encoder | undefined {
  if (acceptEncoding === undefined) return undefined;

  const qualities = new Map<string, number>();

  for (const entry of acceptEncoding.split(",")) {
    const [name = "", ...parameters] = entry.split(";").map((part) => part.trim());

    if (name !== "") qualities.set(name.toLowerCase(), qualityOf(parameters));
  }

  let preferred: { encoder: Encoder; quality: number } | undefined;

  for (const encoder of ENCODERS) {
    const quality = qualities.get(encoder[0]) ?? qualities.get(ANY_CODING) ?? 0;

    if (quality > 0 && (preferred === undefined || quality > preferred.quality)) {
      preferred = { encoder, quality };
    }
  }

  return preferred?.encoder;
}

// A coding without a numeric `q` has quality 1 (RFC 9110 section 12.4.2).
function qualityOf(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const quality = QUALITY_PARAMETER.exec(parameter)?.[1];

    if (quality !== undefined) return Number(quality);
  }

  return FULL_QUALITY;
}
