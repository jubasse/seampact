// Body streams of the Web-standard server profile: a gzip, deflate or br body decoded with the runtime's
// `DecompressionStream`, and a stream read into bytes within a cap.
import { IDENTITY_ENCODING } from "./transport-checks.js";

// The content codings the boundary decodes, by their `DecompressionStream` format.
const DECOMPRESSION_FORMATS: Readonly<Record<string, string>> = {
  gzip: "gzip",
  deflate: "deflate",
  br: "brotli",
};

/** A stream of body bytes, as `Request` and `Response` carry it. */
export type ByteStream = ReadableStream<Uint8Array>;

/** Body bytes over an `ArrayBuffer` of their own, as a body stream carries them. */
export type Bytes = Uint8Array<ArrayBuffer>;

/**
 * What a capped read gives: every byte, or the bytes read past the cap and the whole body as a stream again, which
 * the caller sends or cancels.
 */
export type CappedRead =
  | { readonly kind: "complete"; readonly bytes: Bytes }
  | { readonly kind: "over"; readonly held: Bytes; readonly whole: ByteStream };

/** A format the runtime's `DecompressionStream` takes. */
type DecompressionFormat = ConstructorParameters<typeof DecompressionStream>[0];

/** A chunk the decoder's writable side takes, any `BufferSource`. */
type DecoderChunk =
  DecompressionStream["writable"] extends WritableStream<infer Chunk> ? Chunk : never;

/** The normalized content coding of a header value; identity when absent. */
export function contentCoding(header: string | null | undefined): string {
  return (header ?? IDENTITY_ENCODING).trim().toLowerCase();
}

/** Whether the boundary decodes a content coding: a known one whose format the runtime's decoder takes. */
export function canDecode(coding: string): boolean {
  return decoderOf(coding) !== undefined;
}

/** The source decoded from a content coding, undefined for a coding `canDecode` refuses. */
export function decodedStream(source: ByteStream, coding: string): ByteStream | undefined {
  const decoder = decoderOf(coding);

  if (decoder === undefined) return undefined;

  const input: ReadableStream<DecoderChunk> = source.pipeThrough(
    new TransformStream<Uint8Array, Bytes>({
      transform(chunk, controller) {
        controller.enqueue(ownBufferBytes(chunk));
      },
    }),
  );

  return input.pipeThrough(decoder);
}

/** Reads a stream up to `maxBytes`; past the cap, the bytes held so far and the whole body as a stream. */
export async function readCapped(stream: ByteStream, maxBytes: number): Promise<CappedRead> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) return { kind: "complete", bytes: joinedBytes(chunks, total) };

    chunks.push(value);
    total += value.byteLength;

    if (total > maxBytes) {
      const held = joinedBytes(chunks, total);

      return { kind: "over", held, whole: wholeStream(held, reader) };
    }
  }
}

/** A stream of the bytes, in one chunk. */
export function byteStreamOf(bytes: Uint8Array): ByteStream {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** The chunks as one array of bytes. */
export function joinedBytes(chunks: readonly Uint8Array[], total: number): Bytes {
  const joined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

// The held bytes first, then what the reader has not read yet, so a body read in part goes out whole.
function wholeStream(held: Bytes, reader: ReadableStreamDefaultReader<Uint8Array>): ByteStream {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(held);
    },
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// The DOM typings omit "brotli", which Node, Bun and Deno take; a runtime without a format throws, caught above.
function isDecompressionFormat(format: string): format is DecompressionFormat {
  return Object.values(DECOMPRESSION_FORMATS).includes(format);
}

function decoderOf(coding: string): DecompressionStream | undefined {
  const format = Object.hasOwn(DECOMPRESSION_FORMATS, coding)
    ? DECOMPRESSION_FORMATS[coding]
    : undefined;

  if (format === undefined || !isDecompressionFormat(format)) return undefined;

  try {
    return new DecompressionStream(format);
  } catch {
    // The runtime has no decoder for this format: the caller answers the coding as unsupported.
    return undefined;
  }
}

// A chunk over a shared buffer is copied: a decoder takes bytes over an `ArrayBuffer` only.
function ownBufferBytes(chunk: Uint8Array): Bytes {
  return isOverArrayBuffer(chunk) ? chunk : new Uint8Array(chunk);
}

function isOverArrayBuffer(chunk: Uint8Array): chunk is Bytes {
  return chunk.buffer instanceof ArrayBuffer;
}
