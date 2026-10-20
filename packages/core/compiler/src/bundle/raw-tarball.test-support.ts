import { gzipSync } from "node:zlib";
import {
  USTAR_BLOCK_BYTES,
  USTAR_FIELDS,
  type UstarField,
  ustarChecksum,
  ustarPadded,
} from "./ustar.js";

// Hand-made tarballs: any path, type and content a hostile archive may hold, which the bundle writer never writes.

export interface RawEntry {
  readonly path: string;
  readonly type?: string;
  readonly data?: string | Uint8Array;
  /** The ustar prefix field (GNU headers hold times there). */
  readonly prefix?: string;
  /** The magic and version fields as one: `ustar\u000000` unless given. */
  readonly magic?: string;
  /** The checksum field, computed unless given. */
  readonly checksum?: string;
}

function put(header: Uint8Array, field: UstarField, text: string): void {
  header.set(new TextEncoder().encode(text).subarray(0, field.length), field.offset);
}

function rawHeader(entry: RawEntry, size: number): Uint8Array {
  const header = new Uint8Array(USTAR_BLOCK_BYTES);

  put(header, USTAR_FIELDS.name, entry.path);
  put(header, USTAR_FIELDS.mode, "0000644\0");
  put(header, USTAR_FIELDS.size, `${size.toString(8).padStart(11, "0")}\0`);
  put(header, USTAR_FIELDS.mtime, "00000000000\0");
  put(header, USTAR_FIELDS.type, entry.type ?? "0");
  put(header, USTAR_FIELDS.prefix, entry.prefix ?? "");
  put(
    header,
    {
      offset: USTAR_FIELDS.magic.offset,
      length: USTAR_FIELDS.magic.length + USTAR_FIELDS.version.length,
    },
    entry.magic ?? "ustar\u000000",
  );
  put(
    header,
    USTAR_FIELDS.checksum,
    entry.checksum ?? `${ustarChecksum(header).toString(8).padStart(6, "0")}\0 `,
  );

  return header;
}

export function rawTarball(entries: readonly RawEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    const data =
      typeof entry.data === "string" || entry.data === undefined
        ? new TextEncoder().encode(entry.data ?? "")
        : entry.data;
    const padded = new Uint8Array(ustarPadded(data.length));

    padded.set(data);
    blocks.push(rawHeader(entry, data.length), padded);
  }

  blocks.push(new Uint8Array(2 * USTAR_BLOCK_BYTES));

  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;

  while (`${length}${body}`.length !== length) length++;

  return `${length}${body}`;
}
