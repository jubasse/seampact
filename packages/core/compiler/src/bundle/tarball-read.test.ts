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
import { paxRecord, type RawEntry, rawTarball as tarball } from "./raw-tarball.test-support.js";
import { extractBundleTarball, readBundleTarball } from "./tarball-read.js";

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

  // Only the manifest and portable paths: nothing Windows reads as a device, a stream or another name.
  for (const path of [
    "sources/COM1",
    "sources/aux.yaml",
    "sources/a:b",
    "sources/x.",
    "sources/\u001b[31mred",
    "sources/\u00e9.yaml",
    "evil.sh",
    "package.json",
  ])
    expect(refusal([{ path, data: "x" }]), path).toEqual([["bundle.archive-entry-path", path]]);
  expect(refusal([{ path: "sources/nul/", type: "5" }])).toEqual([
    ["bundle.archive-entry-path", "sources/nul/"],
  ]);
  expect(
    refusal([
      { path: "seampact-bundle.json", data: "{}" },
      { path: "sources/", type: "5" },
      { path: "sources/a.yaml", data: "x" },
    ]),
  ).toBe("accepted");

  // Non-ASCII names are refused, so no Unicode case fold arises (the Kelvin sign folds to k in Unicode only).
  expect(refusal([{ path: "sources/k.yaml" }, { path: "sources/\u212a.yaml" }])).toEqual([
    ["bundle.archive-entry-path", "sources/\u212a.yaml"],
  ]);

  // Decimal pax lengths only; GNU headers hold times where ustar holds the prefix.
  expect(
    refusal([
      { path: "PaxHeader", type: "x", data: "0x1b path=sources/bcd.yaml\n" },
      { path: "sources/a.yaml" },
    ]),
  ).toEqual([["bundle.archive-invalid", "PaxHeader"]]);
  expect(
    readBundleTarball(
      tarball([{ path: "sources/a.yaml", magic: "ustar  \0", prefix: "14712345670" }]),
    ),
  ).toMatchObject({ ok: true, entries: [{ path: "sources/a.yaml" }] });
  expect(readBundleTarball(tarball([{ path: "a.yaml", prefix: "sources" }]))).toMatchObject({
    ok: true,
    entries: [{ path: "sources/a.yaml" }],
  });
  expect(refusal([{ path: "sources/a.yaml", checksum: "0000000\0" }])).toEqual([
    ["bundle.archive-invalid", undefined],
  ]);

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

const FIRST_PRINTABLE = 0x20;

test("an entry name is quoted in the refusal, never printed raw", () => {
  const hostile = `\u001b[2J${"x".repeat(200_000)}`;
  const read = readBundleTarball(
    tarball([
      { path: "PaxHeader", type: "x", data: paxRecord("path", hostile) },
      { path: "sources/a.yaml", type: "2" },
    ]),
  );
  const duplicate = readBundleTarball(
    tarball([
      { path: "sources/a.yaml" },
      { path: "PaxHeader", type: "x", data: paxRecord("path", "sources/\u001b]0;pwned\u0007") },
      { path: "sources/b.yaml" },
    ]),
  );

  for (const refused of [read, duplicate]) {
    const failure = refused.ok ? undefined : refused.failures[0];

    const controlCharacters = [...(failure?.message ?? "")].filter(
      (character) => (character.codePointAt(0) ?? 0) < FIRST_PRINTABLE,
    );

    expect(controlCharacters).toEqual([]);
    expect(failure?.message.length).toBeLessThan(300);
  }

  expect(read.ok ? undefined : read.failures[0]?.file).toBe(hostile);
});
