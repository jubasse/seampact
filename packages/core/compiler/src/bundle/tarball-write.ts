import { constants, gzipSync } from "node:zlib";
import type { BundleContents, BundleEntry } from "./contents.js";
import { bundleEntries } from "./contents.js";
import {
  USTAR_BLOCK_BYTES,
  USTAR_FIELDS,
  USTAR_MAGIC,
  USTAR_TYPE_FILE,
  USTAR_VERSION,
  type UstarField,
  ustarChecksum,
  ustarPadded,
  ustarPathSplit,
} from "./ustar.js";

// The bundle tarball (ADR 0011): ustar, regular files only, no directory entries, every entry at the root and
// sorted by path in code-unit order, mode 0644, uid and gid 0, empty owner names, mtime 0; gzip level 9 with
// mtime 0, no file name and the OS byte 255 (unknown). The same contents give the same bytes on every machine.

const FILE_MODE = 0o644;
const GZIP_OS_BYTE_OFFSET = 9;
const GZIP_OS_UNKNOWN = 255;
const END_OF_ARCHIVE_BLOCKS = 2;

const GZIP_OPTIONS = {
  level: constants.Z_BEST_COMPRESSION,
  memLevel: 8,
  windowBits: 15,
  strategy: constants.Z_DEFAULT_STRATEGY,
} as const;

/** The gzipped ustar bytes of a bundle. */
export function bundleTarball(contents: BundleContents): Uint8Array {
  const gzipped = new Uint8Array(gzipSync(ustarArchive(bundleEntries(contents)), GZIP_OPTIONS));

  gzipped[GZIP_OS_BYTE_OFFSET] = GZIP_OS_UNKNOWN;

  return gzipped;
}

function ustarArchive(entries: readonly BundleEntry[]): Uint8Array {
  const total =
    entries.reduce((sum, entry) => sum + USTAR_BLOCK_BYTES + ustarPadded(entry.bytes.length), 0) +
    END_OF_ARCHIVE_BLOCKS * USTAR_BLOCK_BYTES;
  const archive = new Uint8Array(total);
  let offset = 0;

  for (const entry of entries) {
    archive.set(ustarHeader(entry), offset);
    archive.set(entry.bytes, offset + USTAR_BLOCK_BYTES);
    offset += USTAR_BLOCK_BYTES + ustarPadded(entry.bytes.length);
  }

  return archive;
}

function ustarHeader(entry: BundleEntry): Uint8Array {
  const split = ustarPathSplit(entry.path);

  // The builder refuses such a path first (`bundle.path-unportable`).
  if (split === undefined) throw new Error(`bundle: '${entry.path}' does not fit a ustar header.`);

  const header = new Uint8Array(USTAR_BLOCK_BYTES);

  writeText(header, USTAR_FIELDS.name, split.name);
  writeOctal(header, USTAR_FIELDS.mode, FILE_MODE);
  writeOctal(header, USTAR_FIELDS.uid, 0);
  writeOctal(header, USTAR_FIELDS.gid, 0);
  writeOctal(header, USTAR_FIELDS.size, entry.bytes.length);
  writeOctal(header, USTAR_FIELDS.mtime, 0);
  writeText(header, USTAR_FIELDS.type, USTAR_TYPE_FILE);
  writeText(header, USTAR_FIELDS.magic, USTAR_MAGIC);
  writeText(header, USTAR_FIELDS.version, USTAR_VERSION);
  writeOctal(header, USTAR_FIELDS.deviceMajor, 0);
  writeOctal(header, USTAR_FIELDS.deviceMinor, 0);
  writeText(header, USTAR_FIELDS.prefix, split.prefix);
  writeChecksum(header);

  return header;
}

// ASCII only: bundle paths and the fixed fields are.
function writeText(header: Uint8Array, field: UstarField, text: string): void {
  for (let index = 0; index < text.length && index < field.length; index++)
    header[field.offset + index] = text.charCodeAt(index);
}

// Zero-padded octal digits filling the field but its last byte, which stays NUL.
function writeOctal(header: Uint8Array, field: UstarField, value: number): void {
  writeText(header, field, value.toString(8).padStart(field.length - 1, "0"));
}

// Six octal digits, a NUL and a space, as POSIX tar writes it.
function writeChecksum(header: Uint8Array): void {
  const digits = ustarChecksum(header).toString(8).padStart(6, "0");

  writeText(header, USTAR_FIELDS.checksum, `${digits}\0 `);
}
