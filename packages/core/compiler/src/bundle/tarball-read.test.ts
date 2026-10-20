import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, gzipSync } from "node:zlib";
import {
  BUNDLE_ARCHIVE_BYTES_MAX,
  BUNDLE_ENTRIES_MAX,
  BUNDLE_EXTRACTED_BYTES_MAX,
} from "@seampact/spec/bundle";
import { expect, test } from "vitest";
import { extractBundleTarball, readBundleTarball } from "./tarball-read.js";
import {
  USTAR_BLOCK_BYTES,
  USTAR_FIELDS,
  type UstarField,
  ustarChecksum,
  ustarPadded,
} from "./ustar.js";

// Hand-made tarballs: any path and type a hostile archive may hold.

interface RawEntry {
  readonly path: string;
  readonly type?: string;
  readonly data?: string;
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
  put(header, USTAR_FIELDS.magic, "ustar\0");
  put(header, USTAR_FIELDS.version, "00");
  put(header, USTAR_FIELDS.checksum, `${ustarChecksum(header).toString(8).padStart(6, "0")}\0 `);

  return header;
}

function tarball(entries: readonly RawEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    const data = new TextEncoder().encode(entry.data ?? "");
    const padded = new Uint8Array(ustarPadded(data.length));

    padded.set(data);
    blocks.push(rawHeader(entry, data.length), padded);
  }

  blocks.push(new Uint8Array(2 * USTAR_BLOCK_BYTES));

  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;

  while (`${length}${body}`.length !== length) length++;

  return `${length}${body}`;
}

function refusal(entries: readonly RawEntry[]): unknown {
  const read = readBundleTarball(tarball(entries));

  return read.ok ? "accepted" : read.failures.map((failure) => [failure.code, failure.file]);
}

test("archive reader refuses unsafe entries", () => {
  const unsafePaths = [
    "../escape.yaml",
    "sources/../../escape.yaml",
    "/etc/passwd",
    "C:/escape.yaml",
    "sources\\a.yaml",
    "./sources/a.yaml",
  ];

  for (const path of unsafePaths)
    expect(refusal([{ path, data: "x" }])).toEqual([["bundle.archive-entry-path", path]]);

  for (const type of ["1", "2", "3", "4", "6", "7", "L", "K"])
    expect(refusal([{ path: "sources/a.yaml", type, data: "" }])).toEqual([
      ["bundle.archive-entry-type", "sources/a.yaml"],
    ]);

  expect(refusal([{ path: "sources/a.yaml" }, { path: "sources/a.yaml" }])).toEqual([
    ["bundle.archive-entry-duplicate", "sources/a.yaml"],
  ]);
  expect(refusal([{ path: "sources/a.yaml" }, { path: "sources/A.yaml" }])).toEqual([
    ["bundle.archive-entry-duplicate", "sources/A.yaml"],
  ]);
  expect(refusal([{ path: "sources/a" }, { path: "sources/a/b.yaml" }])).toEqual([
    ["bundle.archive-entry-path", "sources/a/b.yaml"],
  ]);

  // A pax path is checked like a header path; a global pax header is ignored.
  expect(
    refusal([
      { path: "PaxHeader", type: "x", data: paxRecord("path", "../escape.yaml") },
      { path: "sources/a.yaml" },
    ]),
  ).toEqual([["bundle.archive-entry-path", "../escape.yaml"]]);
  expect(
    refusal([
      { path: "PaxGlobal", type: "g", data: paxRecord("comment", "x") },
      { path: "sources/a.yaml", data: "x" },
    ]),
  ).toBe("accepted");

  // The caps, each before the bytes are kept.
  expect(readBundleTarball(new Uint8Array(BUNDLE_ARCHIVE_BYTES_MAX + 1))).toMatchObject({
    failures: [{ code: "bundle.archive-too-large" }],
  });
  expect(
    refusal(
      Array.from({ length: BUNDLE_ENTRIES_MAX + 1 }, (_, index) => ({
        path: `sources/${index}.yaml`,
      })),
    ),
  ).toEqual([["bundle.archive-too-many-entries", undefined]]);
  const bomb = new Uint8Array(
    gzipSync(new Uint8Array(BUNDLE_EXTRACTED_BYTES_MAX + 1), { level: constants.Z_BEST_SPEED }),
  );

  expect(readBundleTarball(bomb)).toMatchObject({
    failures: [{ code: "bundle.archive-extracted-too-large" }],
  });
  expect(readBundleTarball(new TextEncoder().encode("not gzip"))).toMatchObject({
    failures: [{ code: "bundle.archive-invalid" }],
  });
});

test("a refused tarball writes nothing", () => {
  const extracted = extractBundleTarball(
    tarball([
      { path: "sources/a.yaml", data: "x" },
      { path: "../escape.yaml", data: "x" },
    ]),
  );

  expect(extracted.ok).toBe(false);
  expect(existsSync(join(tmpdir(), "escape.yaml"))).toBe(false);
});
