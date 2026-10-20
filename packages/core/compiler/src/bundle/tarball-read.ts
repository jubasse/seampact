import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  BUNDLE_ARCHIVE_BYTES_MAX,
  BUNDLE_ENTRIES_MAX,
  BUNDLE_EXTRACTED_BYTES_MAX,
  type BundleFailure,
} from "@seampact/spec/bundle";
import type { BundleEntry } from "./contents.js";
import {
  GNU_MAGIC_AND_VERSION,
  PAX_TYPE_EXTENDED,
  PAX_TYPE_GLOBAL,
  USTAR_BLOCK_BYTES,
  USTAR_FIELDS,
  USTAR_MAGIC,
  USTAR_TYPE_DIRECTORY,
  USTAR_TYPE_FILE,
  USTAR_TYPE_FILE_OLD,
  USTAR_VERSION,
  type UstarField,
  ustarChecksum,
  ustarPadded,
} from "./ustar.js";

// The bundle tarball reader. A tarball comes from the network, so it is read whole in memory and every entry
// checked before any byte is written: regular files (`0`) and directories (`5`) only, pax extended headers (`x`)
// for `path` and `size` only, global pax headers (`g`) ignored, every other type refused; no `..` or `.` segment,
// absolute or drive path, backslash, duplicate (also once folded to lower case) or path that is both a file and a
// directory; the caps of `@seampact/spec/bundle`. Only then are the files written, into a new temporary directory.

export type BundleArchiveRead =
  | { readonly ok: true; readonly entries: readonly BundleEntry[] }
  | { readonly ok: false; readonly failures: readonly BundleFailure[] };

export type BundleArchiveExtraction =
  | { readonly ok: true; readonly directory: string }
  | { readonly ok: false; readonly failures: readonly BundleFailure[] };

const NUL = 0;
const OCTAL = /^[0-7]+$/u;
const DRIVE_PATH = /^[A-Za-z]:/u;
const TEMPORARY_PREFIX = "seampact-bundle-";
const FILE_MODE = 0o644;

/** Extracts a bundle tarball into a new temporary directory the caller removes, or refuses it whole. */
export function extractBundleTarball(tarball: Uint8Array): BundleArchiveExtraction {
  const read = readBundleTarball(tarball);

  if (!read.ok) return read;

  const directory = mkdtempSync(join(tmpdir(), TEMPORARY_PREFIX));

  try {
    for (const entry of read.entries) {
      const target = join(directory, ...entry.path.split("/"));

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes, { flag: "wx", mode: FILE_MODE });
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });

    throw new Error(
      `bundle: writing the checked tarball entries into '${directory}' failed: ${String(error)}`,
    );
  }

  return { ok: true, directory };
}

/** The regular files of a bundle tarball, or the one failure that refuses it. */
export function readBundleTarball(tarball: Uint8Array): BundleArchiveRead {
  if (tarball.length > BUNDLE_ARCHIVE_BYTES_MAX)
    return refused({
      code: "bundle.archive-too-large",
      message: `The tarball holds ${tarball.length} bytes, over the cap of ${BUNDLE_ARCHIVE_BYTES_MAX}.`,
      fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
      expected: String(BUNDLE_ARCHIVE_BYTES_MAX),
      actual: String(tarball.length),
    });

  const archive = gunzipped(tarball);

  if (!(archive instanceof Uint8Array)) return refused(archive);

  return new UstarParser(archive).parse();
}

function refused(failure: BundleFailure): BundleArchiveRead {
  return { ok: false, failures: [failure] };
}

function gunzipped(tarball: Uint8Array): Uint8Array | BundleFailure {
  try {
    return new Uint8Array(gunzipSync(tarball, { maxOutputLength: BUNDLE_EXTRACTED_BYTES_MAX }));
  } catch (error) {
    if (error instanceof RangeError)
      return {
        code: "bundle.archive-extracted-too-large",
        message: `The tarball holds more than ${BUNDLE_EXTRACTED_BYTES_MAX} bytes once uncompressed.`,
        fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
        expected: String(BUNDLE_EXTRACTED_BYTES_MAX),
      };

    return invalid(
      `it is not gzip data (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function invalid(reason: string, file?: string): BundleFailure {
  return {
    code: "bundle.archive-invalid",
    message: `The tarball cannot be read: ${reason}.`,
    fix: "Download the bundle again, or rebuild it with `seampact bundle`.",
    ...(file === undefined ? {} : { file }),
  };
}

interface PaxOverrides {
  path?: string;
  size?: number;
}

class UstarParser {
  private offset = 0;
  private entryCount = 0;
  private pax: PaxOverrides = {};
  private readonly archive: Uint8Array;
  private readonly files: BundleEntry[] = [];
  // Paths folded to lower case: of the files, and of every directory (an entry's or a file's parent).
  private readonly fileByFold = new Map<string, string>();
  private readonly directoryFolds = new Set<string>();

  constructor(archive: Uint8Array) {
    this.archive = archive;
  }

  parse(): BundleArchiveRead {
    for (;;) {
      if (this.offset + USTAR_BLOCK_BYTES > this.archive.length)
        return refused(invalid("it ends before its end-of-archive block"));

      const header = this.archive.subarray(this.offset, this.offset + USTAR_BLOCK_BYTES);

      if (header.every((byte) => byte === NUL)) return { ok: true, entries: this.files };

      const failure = this.entry(header);

      if (failure !== undefined) return refused(failure);
    }
  }

  private entry(header: Uint8Array): BundleFailure | undefined {
    this.entryCount++;

    if (this.entryCount > BUNDLE_ENTRIES_MAX)
      return {
        code: "bundle.archive-too-many-entries",
        message: `The tarball holds more than ${BUNDLE_ENTRIES_MAX} entries.`,
        fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
        expected: String(BUNDLE_ENTRIES_MAX),
      };

    const headerProblem = this.headerProblem(header);

    if (headerProblem !== undefined) return invalid(headerProblem);

    const type = text(header, USTAR_FIELDS.type);
    const size = this.pax.size ?? octal(header, USTAR_FIELDS.size);
    const path = this.pax.path ?? headerPath(header);

    if (size === undefined) return invalid("an entry's size is not octal digits", path);

    const dataStart = this.offset + USTAR_BLOCK_BYTES;

    if (dataStart + size > this.archive.length) return invalid("it ends inside an entry", path);

    const data = this.archive.subarray(dataStart, dataStart + size);

    this.offset = dataStart + ustarPadded(size);

    return this.typed(type, path, data);
  }

  private typed(type: string, path: string, data: Uint8Array): BundleFailure | undefined {
    if (type === PAX_TYPE_GLOBAL) return undefined;

    if (type === PAX_TYPE_EXTENDED) {
      const read = paxOverrides(data);

      if (typeof read === "string") return invalid(read, path);
      this.pax = read;

      return undefined;
    }

    this.pax = {};

    if (type === USTAR_TYPE_DIRECTORY) return this.directory(path);

    if (type === USTAR_TYPE_FILE || type === USTAR_TYPE_FILE_OLD) return this.file(path, data);

    return {
      code: "bundle.archive-entry-type",
      message: `The tarball entry '${path}' is of type ${JSON.stringify(type)}; a bundle holds regular files only.`,
      fix: "Rebuild the bundle with `seampact bundle`: it writes no link, device or other special entry.",
      file: path,
    };
  }

  private headerProblem(header: Uint8Array): string | undefined {
    const magic = text(header, USTAR_FIELDS.magic, { keepNul: true });
    const magicAndVersion = `${magic}${text(header, USTAR_FIELDS.version, { keepNul: true })}`;

    if (magic !== USTAR_MAGIC && magicAndVersion !== GNU_MAGIC_AND_VERSION)
      return "an entry is not a ustar header";

    if (
      magic === USTAR_MAGIC &&
      text(header, USTAR_FIELDS.version, { keepNul: true }) !== USTAR_VERSION
    )
      return "an entry has an unknown ustar version";

    if (octal(header, USTAR_FIELDS.checksum) !== ustarChecksum(header))
      return "an entry header's checksum does not match";

    return undefined;
  }

  private directory(path: string): BundleFailure | undefined {
    const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
    const problem = entryPathProblem(trimmed);

    if (problem !== undefined) return unsafePath(path, problem);

    if (this.fileByFold.has(trimmed.toLowerCase()))
      return unsafePath(path, "is both a file and a directory");

    this.addParentDirectories(trimmed);
    this.directoryFolds.add(trimmed.toLowerCase());

    return undefined;
  }

  private file(path: string, data: Uint8Array): BundleFailure | undefined {
    const problem = entryPathProblem(path);

    if (problem !== undefined) return unsafePath(path, problem);

    const folded = path.toLowerCase();
    const seen = this.fileByFold.get(folded);

    if (seen !== undefined)
      return {
        code: "bundle.archive-entry-duplicate",
        message:
          seen === path
            ? `The tarball holds '${path}' twice.`
            : `The tarball holds '${path}' and '${seen}', one file on a case-insensitive file system.`,
        fix: "Rebuild the bundle with `seampact bundle`: it writes each file once.",
        file: path,
      };

    const parents = parentPaths(path);

    if (
      this.directoryFolds.has(folded) ||
      parents.some((parent) => this.fileByFold.has(parent.toLowerCase()))
    )
      return unsafePath(path, "is both a file and a directory");

    this.fileByFold.set(folded, path);
    this.addParentDirectories(path);
    this.files.push({ path, bytes: new Uint8Array(data) });

    return undefined;
  }

  private addParentDirectories(path: string): void {
    for (const parent of parentPaths(path)) this.directoryFolds.add(parent.toLowerCase());
  }
}

// `a`, `a/b` for `a/b/c`.
function parentPaths(path: string): string[] {
  const segments = path.split("/");

  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function unsafePath(path: string, problem: string): BundleFailure {
  return {
    code: "bundle.archive-entry-path",
    message: `The tarball entry ${JSON.stringify(path)} ${problem}; it could be written outside the bundle.`,
    fix: "Rebuild the bundle with `seampact bundle`: its entries are relative paths under the bundle root.",
    file: path,
  };
}

function entryPathProblem(path: string): string | undefined {
  if (path === "") return "has an empty path";

  if (path.includes("\0")) return "holds a NUL character";

  if (path.includes("\\")) return "holds a backslash";

  if (path.startsWith("/") || DRIVE_PATH.test(path)) return "is an absolute path";

  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
    return "has an empty, '.' or '..' segment";

  return undefined;
}

function headerPath(header: Uint8Array): string {
  const name = text(header, USTAR_FIELDS.name);
  const prefix = text(header, USTAR_FIELDS.prefix);

  return prefix === "" ? name : `${prefix}/${name}`;
}

const UTF8 = new TextDecoder("utf-8", { fatal: false });

// A field's text up to its first NUL; a non-UTF-8 byte reads as U+FFFD, which no bundle path holds.
function text(header: Uint8Array, field: UstarField, options: { keepNul?: boolean } = {}): string {
  const bytes = header.subarray(field.offset, field.offset + field.length);
  const end = options.keepNul === true ? bytes.length : bytes.indexOf(NUL);

  return UTF8.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

// Octal digits, with the leading and trailing spaces and NULs tar writers leave; base-256 sizes are refused.
function octal(header: Uint8Array, field: UstarField): number | undefined {
  const digits = text(header, field, { keepNul: true }).replace(/^[ \0]+|[ \0]+$/gu, "");

  return OCTAL.test(digits) ? Number.parseInt(digits, 8) : undefined;
}

// A pax extended header's records, `<length> <key>=<value>\n`: `path` and `size` are read, the others ignored.
function paxOverrides(data: Uint8Array): PaxOverrides | string {
  const overrides: PaxOverrides = {};
  let offset = 0;

  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const length = space === -1 ? Number.NaN : Number(UTF8.decode(data.subarray(offset, space)));

    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length)
      return "a pax record's length is not a number inside the header";

    const record = UTF8.decode(data.subarray(space + 1, offset + length - 1));
    const equals = record.indexOf("=");

    if (equals === -1 || data[offset + length - 1] !== 0x0a) return "a pax record is not key=value";

    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);

    if (key === "path") overrides.path = value;

    if (key === "size") {
      if (!/^\d+$/u.test(value)) return "a pax size is not a decimal number";
      overrides.size = Number(value);
    }

    offset += length;
  }

  return overrides;
}
