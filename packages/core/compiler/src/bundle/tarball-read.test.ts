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
import { paxRecord, type RawEntry, rawTarball as tarball } from "./raw-tarball.test-support.js";

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
