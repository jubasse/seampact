import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_MANIFEST_FILE,
  type BundleFailure,
  type BundleFailureCode,
} from "@seampact/spec/bundle";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { loadMemoryReader } from "../load/reader.js";
import { builtContents, PACK_CONTRACT } from "./bundle.test-support.js";
import { bundleEntries, bundleManifestBytes } from "./contents.js";
import { paxRecord, type RawEntry, rawTarball } from "./raw-tarball.test-support.js";
import { type ManifestEdit, resealFiles } from "./reseal.test-support.js";
import { readBundleTarball } from "./tarball-read.js";
import { bundleTarball } from "./tarball-write.js";
import { type BundleChannel, verifyBundle } from "./verify.js";

// The bundle vectors (`@seampact/spec/bundle/vectors/vectors.json`): a small bundle, as a directory and as a
// tarball, untouched and tampered once per failure code, each with the outcome every verifier gives. Generated
// here, since only the compiler bundles; `SEAMPACT_WRITE_BUNDLE_VECTORS=1 pnpm vitest run
// packages/core/compiler/src/bundle/vectors.test.ts` rewrites the file after a change of the IR or the format.

export const VECTORS_FILE = fileURLToPath(
  new URL("../../../spec/vectors/bundle/vectors.json", import.meta.url),
);

export interface VectorFailure {
  readonly code: BundleFailureCode;
  readonly file?: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface DirectoryVector {
  readonly id: string;
  readonly description: string;
  readonly channel: BundleChannel;
  readonly pin: string | null;
  readonly files: readonly { readonly path: string; readonly base64: string }[];
  readonly expected: {
    readonly ok: boolean;
    readonly integrity: string | null;
    readonly failures: readonly VectorFailure[];
  };
}

export interface ArchiveVector {
  readonly id: string;
  readonly description: string;
  readonly base64: string;
  readonly expected: {
    readonly ok: boolean;
    readonly paths: readonly string[];
    readonly failures: readonly VectorFailure[];
  };
}

export interface BundleVectors {
  readonly formatVersion: 1;
  readonly directories: readonly DirectoryVector[];
  readonly archives: readonly ArchiveVector[];
}

// The compiler version is in the manifest only, never in the integrity: fixed, so a release does not move the file.
const VECTOR_COMPILER = { name: "@seampact/compiler", version: "0.0.0" };

type Files = Map<string, Uint8Array>;

interface DirectoryCase {
  readonly id: string;
  readonly description: string;
  readonly channel?: BundleChannel;
  /** The pin: the bundle's integrity unless given; null pins nothing. */
  readonly pin?: string | null;
  readonly tamper?: (files: Files) => void;
  /** Reseal the manifest after the tamper, so steps 1 and 2 pass. */
  readonly reseal?: ManifestEdit;
  readonly failure?: { readonly code: BundleFailureCode; readonly files?: readonly string[] };
}

const OTHER_INTEGRITY = `sha256-${"A".repeat(43)}=`;
const IR_FILE = "ir/t.json";
const SOURCE_FILE = "sources/api.yaml";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const read = (files: Files, path: string): string => new TextDecoder().decode(files.get(path));

function replaceIn(files: Files, path: string, from: string, to: string): void {
  const before = read(files, path);

  if (!before.includes(from)) throw new Error(`vectors: '${path}' holds no '${from}'`);
  files.set(path, text(before.replace(from, to)));
}

function flipFirstByte(files: Files, path: string): void {
  const bytes = new Uint8Array(files.get(path) ?? []);

  bytes[0] = (bytes[0] ?? 0) ^ 1;
  files.set(path, bytes);
}

// Edits the manifest's text, with no reseal: the manifest itself is what the case refuses.
function editManifestText(files: Files, edit: (text: string) => string): void {
  files.set(BUNDLE_MANIFEST_FILE, text(edit(read(files, BUNDLE_MANIFEST_FILE))));
}

// Edits the manifest's members, with no reseal.
function editManifest(files: Files, edit: ManifestEdit): void {
  files.set(
    BUNDLE_MANIFEST_FILE,
    bundleManifestBytes(edit(JSON.parse(read(files, BUNDLE_MANIFEST_FILE)))),
  );
}

// The manifest listing one more file (absent from the bundle), at its sorted place.
function listingAlso(path: string): ManifestEdit {
  return (manifest) => ({
    ...manifest,
    files: [...manifest.files, { path, size: 1, sha256: "0".repeat(64) }].sort((left, right) =>
      left.path < right.path ? -1 : 1,
    ),
  });
}

const MANIFEST_INVALID = {
  code: "bundle.manifest-invalid",
  files: [BUNDLE_MANIFEST_FILE],
} as const;

const withApi =
  (edit: (api: { irVersion: number; irRevision: number }) => object): ManifestEdit =>
  (manifest) => ({
    ...manifest,
    apis: manifest.apis.map((api) => ({ ...api, ...edit(api) })),
  });

const DIRECTORY_CASES: readonly DirectoryCase[] = [
  { id: "valid", description: "The untouched bundle, pinned." },
  {
    id: "valid-package-extras",
    description: "npm's own files at the root of a package source are allowed.",
    channel: "package",
    tamper: (files) => {
      files.set("package.json", text('{ "name": "@acme/contract", "version": "3.1.0" }\n'));
      files.set("README.md", text("# contract\n"));
    },
  },
  {
    id: "package-extras-on-release",
    description: "npm's own files are unlisted files on any other source.",
    tamper: (files) => {
      files.set("package.json", text("{}\n"));
      files.set("README.md", text("# contract\n"));
    },
    failure: { code: "bundle.file-unlisted", files: ["README.md", "package.json"] },
  },
  {
    id: "source-byte-changed",
    description: "One byte of a source changed.",
    tamper: (files) => flipFirstByte(files, SOURCE_FILE),
    failure: { code: "bundle.file-hash", files: [SOURCE_FILE] },
  },
  {
    id: "ir-byte-changed",
    description: "One byte of an IR changed.",
    tamper: (files) => flipFirstByte(files, IR_FILE),
    failure: { code: "bundle.file-hash", files: [IR_FILE] },
  },
  {
    id: "file-size-changed",
    description: "A source with one more byte.",
    tamper: (files) => files.set(SOURCE_FILE, text(`${read(files, SOURCE_FILE)}\n`)),
    failure: { code: "bundle.file-size", files: [SOURCE_FILE] },
  },
  {
    id: "manifest-size-rounded",
    description:
      "A source size written with a fraction past double precision: every reader rounds it to the size, as JSON.parse does.",
    tamper: (files) =>
      editManifestText(files, (manifest) =>
        manifest.replace(
          new RegExp(`("path": "${SOURCE_FILE}",[^}]*"size": )(\\d+)`),
          (_match, prefix: string, size: string) =>
            `${prefix}${Number(size) - 1}.99999999999999999999`,
        ),
      ),
  },
  {
    id: "file-added",
    description: "A file the manifest does not list.",
    tamper: (files) => files.set("sources/extra.yaml", text("x: 1\n")),
    failure: { code: "bundle.file-unlisted", files: ["sources/extra.yaml"] },
  },
  {
    id: "file-removed",
    description: "A listed file missing.",
    tamper: (files) => files.delete(SOURCE_FILE),
    failure: { code: "bundle.file-missing", files: [SOURCE_FILE] },
  },
  {
    id: "manifest-integrity-edited",
    description: "The manifest's integrity replaced, and pinned.",
    pin: OTHER_INTEGRITY,
    tamper: (files) => {
      const manifest = JSON.parse(read(files, BUNDLE_MANIFEST_FILE));

      replaceIn(files, BUNDLE_MANIFEST_FILE, manifest.integrity, OTHER_INTEGRITY);
    },
    failure: { code: "bundle.integrity-mismatch", files: [BUNDLE_MANIFEST_FILE] },
  },
  {
    id: "pin-wrong",
    description: "A pin of another bundle.",
    pin: OTHER_INTEGRITY,
    failure: { code: "bundle.pin-mismatch" },
  },
  {
    id: "pin-missing",
    description: "No pin: the actual integrity is the value to copy.",
    pin: null,
    failure: { code: "bundle.pin-missing" },
  },
  {
    id: "manifest-missing",
    description: "No manifest.",
    tamper: (files) => files.delete(BUNDLE_MANIFEST_FILE),
    failure: { code: "bundle.manifest-missing", files: [BUNDLE_MANIFEST_FILE] },
  },
  {
    id: "manifest-unknown-member",
    description: "A manifest member the schema does not know.",
    tamper: (files) => replaceIn(files, BUNDLE_MANIFEST_FILE, "{", '{\n  "signature": "x",'),
    failure: { code: "bundle.manifest-invalid", files: [BUNDLE_MANIFEST_FILE] },
  },
  {
    id: "manifest-prototype-key",
    description: "A manifest key that reaches a JavaScript prototype.",
    tamper: (files) =>
      replaceIn(
        files,
        BUNDLE_MANIFEST_FILE,
        '"contract": {',
        '"contract": {\n    "__proto__": {},',
      ),
    failure: { code: "bundle.manifest-invalid", files: [BUNDLE_MANIFEST_FILE] },
  },
  {
    id: "manifest-files-unsorted",
    description: "The manifest's files out of code-unit order.",
    tamper: (files) =>
      editManifest(files, (manifest) => ({ ...manifest, files: [...manifest.files].reverse() })),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-case-duplicate",
    description: "Two listed paths equal once folded to ASCII lower case.",
    tamper: (files) => editManifest(files, listingAlso("sources/API.yaml")),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-api-file-other",
    description: "An api whose file is not ir/<name>.json.",
    tamper: (files) =>
      editManifest(
        files,
        withApi(() => ({ file: "ir/other.json" })),
      ),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-api-file-unlisted",
    description: "An api whose file is not in the manifest's files.",
    tamper: (files) =>
      editManifest(files, (manifest) => ({
        ...manifest,
        files: manifest.files.filter((file) => file.path !== IR_FILE),
      })),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-ir-stray",
    description: "A listed ir/ file that is no api's.",
    tamper: (files) => editManifest(files, listingAlso("ir/zz.json")),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-packs-duplicate",
    description: "A pack listed twice, so out of order.",
    tamper: (files) =>
      editManifest(files, (manifest) => ({
        ...manifest,
        packs: [...manifest.packs, ...manifest.packs],
      })),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-label-not-ascii",
    description: "A contract name outside printable ASCII.",
    tamper: (files) =>
      editManifest(files, (manifest) => ({
        ...manifest,
        contract: { ...manifest.contract, name: "caf\u00e9" },
      })),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-path-trailing-dot",
    description:
      "A listed path whose last segment ends in '.', one file with 'sources/a' on Windows.",
    tamper: (files) => editManifest(files, listingAlso("sources/a.")),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-path-device-name",
    description: "A listed path whose segment is a Windows device name before its first '.'.",
    tamper: (files) => editManifest(files, listingAlso("sources/CON.yaml")),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-path-device-name-bare",
    description: "A listed path whose segment is a Windows device name, in lower case.",
    tamper: (files) => editManifest(files, listingAlso("sources/com1")),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-byte-order-mark",
    description: "A manifest starting with a UTF-8 byte order mark.",
    tamper: (files) => editManifestText(files, (manifest) => `\uFEFF${manifest}`),
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-not-utf8",
    description: "A manifest holding a byte that is not UTF-8.",
    tamper: (files) => {
      const bytes = files.get(BUNDLE_MANIFEST_FILE) ?? new Uint8Array();

      files.set(
        BUNDLE_MANIFEST_FILE,
        new Uint8Array([...bytes.subarray(0, 1), 0xff, ...bytes.subarray(1)]),
      );
    },
    failure: MANIFEST_INVALID,
  },
  {
    id: "manifest-duplicate-key",
    description: "A manifest giving one key twice in one object.",
    tamper: (files) =>
      editManifestText(files, (manifest) =>
        manifest.replace('"contract": {', '"contract": { "name": "x",'),
      ),
    failure: MANIFEST_INVALID,
  },
  {
    id: "ir-revision-other",
    description: "An IR of another irRevision, resealed.",
    tamper: (files) =>
      replaceIn(files, IR_FILE, `"irRevision": ${IR_REVISION}`, `"irRevision": ${IR_REVISION + 1}`),
    reseal: withApi(() => ({ irRevision: IR_REVISION + 1 })),
    failure: { code: "bundle.ir-revision", files: [IR_FILE] },
  },
  {
    id: "ir-version-other",
    description: "An IR of another irVersion, resealed.",
    tamper: (files) =>
      replaceIn(files, IR_FILE, `"irVersion": ${IR_VERSION}`, `"irVersion": ${IR_VERSION + 1}`),
    reseal: withApi(() => ({ irVersion: IR_VERSION + 1 })),
    failure: { code: "bundle.ir-version", files: [IR_FILE] },
  },
  {
    id: "ir-declaration-differs",
    description: "An IR whose irRevision differs from the manifest's, resealed.",
    tamper: (files) =>
      replaceIn(files, IR_FILE, `"irRevision": ${IR_REVISION}`, `"irRevision": ${IR_REVISION + 1}`),
    reseal: (manifest) => manifest,
    failure: { code: "bundle.ir-declaration", files: [IR_FILE] },
  },
  {
    id: "ir-schema-invalid",
    description: "An IR the IR JSON Schema refuses, resealed.",
    tamper: (files) => replaceIn(files, IR_FILE, '"operations": [', '"operations": 1, "x": ['),
    reseal: (manifest) => manifest,
    failure: { code: "bundle.ir-invalid", files: [IR_FILE] },
  },
  {
    id: "ir-not-json",
    description: "An IR file that is not JSON, resealed.",
    tamper: (files) => files.set(IR_FILE, text("{")),
    reseal: (manifest) => manifest,
    failure: { code: "bundle.ir-unreadable", files: [IR_FILE] },
  },
];

interface ArchiveCase {
  readonly id: string;
  readonly description: string;
  readonly entries: readonly RawEntry[];
  /** The refusal; none when the archive is read. */
  readonly code?: BundleFailureCode;
}

const ARCHIVE_CASES: readonly ArchiveCase[] = [
  {
    id: "entry-dot-dot",
    description: "An entry above the bundle root.",
    entries: [{ path: "../escape.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-absolute",
    description: "An absolute entry.",
    entries: [{ path: "/escape.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-drive",
    description: "A Windows drive entry.",
    entries: [{ path: "C:/escape.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-backslash",
    description: "A backslash in an entry.",
    entries: [{ path: "sources\\a.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-symlink",
    description: "A symbolic link.",
    entries: [{ path: "sources/a.yaml", type: "2" }],
    code: "bundle.archive-entry-type",
  },
  {
    id: "entry-hardlink",
    description: "A hard link.",
    entries: [{ path: "sources/a.yaml", type: "1" }],
    code: "bundle.archive-entry-type",
  },
  {
    id: "entry-device",
    description: "A character device.",
    entries: [{ path: "sources/a.yaml", type: "3" }],
    code: "bundle.archive-entry-type",
  },
  {
    id: "entry-duplicate",
    description: "One path twice.",
    entries: [{ path: "sources/a.yaml" }, { path: "sources/a.yaml" }],
    code: "bundle.archive-entry-duplicate",
  },
  {
    id: "entry-case-duplicate",
    description: "Two paths one file on a case-insensitive file system.",
    entries: [{ path: "sources/a.yaml" }, { path: "sources/A.yaml" }],
    code: "bundle.archive-entry-duplicate",
  },
  {
    id: "entry-device-name",
    description: "A Windows device name: on Windows the write would open the device.",
    entries: [{ path: "sources/COM1", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-device-name-extension",
    description: "A Windows device name before an extension.",
    entries: [{ path: "sources/aux.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-colon",
    description: "A colon: an alternate data stream on Windows.",
    entries: [{ path: "sources/a:b", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-trailing-dot",
    description: "A segment ending in '.', which Windows drops.",
    entries: [{ path: "sources/x.", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-control-character",
    description: "A control character in a name.",
    entries: [{ path: "sources/\u001b[31mred", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-non-ascii",
    description: "A name outside ASCII.",
    entries: [{ path: "sources/\u00e9.yaml", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-outside-tree",
    description: "A root file that is not the manifest.",
    entries: [{ path: "evil.sh", data: "x" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "entry-file-directory-clash",
    description: "A path that is both a file and a directory.",
    entries: [{ path: "sources/a.yaml" }, { path: "sources/a.yaml/b.yaml" }],
    code: "bundle.archive-entry-path",
  },
  {
    id: "pax-path",
    description: "A pax path overriding the header name, and a global pax header ignored.",
    entries: [
      { path: "PaxGlobal", type: "g", data: paxRecord("comment", "x") },
      { path: "PaxHeader", type: "x", data: paxRecord("path", "sources/b.yaml") },
      { path: "sources/ignored.yaml", data: "x" },
    ],
  },
  {
    id: "pax-path-dot-dot",
    description: "A pax path above the bundle root.",
    entries: [
      { path: "PaxHeader", type: "x", data: paxRecord("path", "../escape.yaml") },
      { path: "sources/a.yaml", data: "x" },
    ],
    code: "bundle.archive-entry-path",
  },
  {
    id: "pax-length-not-decimal",
    description: "A pax record length that is not decimal digits.",
    entries: [
      { path: "PaxHeader", type: "x", data: "0x1b path=sources/bcd.yaml\n" },
      { path: "sources/a.yaml", data: "x" },
    ],
    code: "bundle.archive-invalid",
  },
  {
    id: "prefix-field",
    description: "A path over 100 characters, split into the prefix field.",
    entries: [{ path: `${"b".repeat(100)}.yaml`.slice(0, 100), prefix: "sources/long", data: "x" }],
  },
  {
    id: "gnu-magic",
    description:
      "A GNU header, whose times sit where ustar holds the prefix: the path is the name only.",
    entries: [{ path: "sources/a.yaml", magic: "ustar  \u0000", prefix: "14712345670", data: "x" }],
  },
  {
    id: "gnu-long-name",
    description: "A GNU long-name entry.",
    entries: [{ path: "././@LongLink", type: "L", data: "sources/a.yaml" }],
    code: "bundle.archive-entry-type",
  },
  {
    id: "bad-checksum",
    description: "A header whose checksum does not match.",
    entries: [{ path: "sources/a.yaml", checksum: "0000000\u0000", data: "x" }],
    code: "bundle.archive-invalid",
  },
  {
    id: "bad-magic",
    description: "A header with no ustar magic.",
    entries: [{ path: "sources/a.yaml", magic: "xxxxx\u000000", data: "x" }],
    code: "bundle.archive-invalid",
  },
];

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function vectorFailure(failure: BundleFailure): VectorFailure {
  return {
    code: failure.code,
    ...(failure.file === undefined ? {} : { file: failure.file }),
    ...(failure.expected === undefined ? {} : { expected: failure.expected }),
    ...(failure.actual === undefined ? {} : { actual: failure.actual }),
  };
}

function baseFiles(): Files {
  const contents = builtContents({ reader: loadMemoryReader(PACK_CONTRACT), entry: "api.yaml" });
  const manifest = { ...contents.manifest, compiler: VECTOR_COMPILER };

  return new Map(
    bundleEntries({ ...contents, manifest }).map((entry) => [entry.path, entry.bytes]),
  );
}

// Writes the files, verifies them and checks the outcome is the one the case declares.
function directoryVector(base: Files, integrity: string, spec: DirectoryCase): DirectoryVector {
  const files = new Map(base);

  spec.tamper?.(files);
  const pin =
    spec.pin === undefined
      ? spec.reseal === undefined
        ? integrity
        : resealFiles(files, spec.reseal)
      : spec.pin;
  const directory = mkdtempSync(join(tmpdir(), "seampact-bundle-vectors-"));

  try {
    for (const [path, bytes] of files) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), bytes);
    }

    const channel = spec.channel ?? "release";
    const verified = verifyBundle(directory, pin ?? undefined, { channel });
    const failures = verified.ok ? [] : verified.failures.map(vectorFailure);
    const declared =
      spec.failure === undefined
        ? []
        : (spec.failure.files ?? [undefined]).map((file) => [spec.failure?.code, file]);

    if (
      JSON.stringify(failures.map((failure) => [failure.code, failure.file])) !==
      JSON.stringify(declared)
    )
      throw new Error(
        `vectors: case '${spec.id}' gives ${JSON.stringify(failures)}, not ${JSON.stringify(declared)}`,
      );

    return {
      id: spec.id,
      description: spec.description,
      channel,
      pin,
      files: [...files]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([path, bytes]) => ({ path, base64: base64(bytes) })),
      expected: { ok: verified.ok, integrity: verified.integrity ?? null, failures },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function archiveVector(
  id: string,
  description: string,
  tarball: Uint8Array,
  code?: BundleFailureCode,
): ArchiveVector {
  const read = readBundleTarball(tarball);
  const codes = read.ok ? [] : read.failures.map((failure) => failure.code);

  if (JSON.stringify(codes) !== JSON.stringify(code === undefined ? [] : [code]))
    throw new Error(`vectors: archive case '${id}' gives ${JSON.stringify(codes)}, not ${code}`);

  return {
    id,
    description,
    base64: base64(tarball),
    expected: read.ok
      ? { ok: true, paths: read.entries.map((entry) => entry.path), failures: [] }
      : { ok: false, paths: [], failures: read.failures.map(vectorFailure) },
  };
}

/** Every vector, as the current compiler and verifier give them. */
export function bundleVectors(): BundleVectors {
  const base = baseFiles();
  const integrity = JSON.parse(read(base, BUNDLE_MANIFEST_FILE)).integrity;
  const contents = builtContents({ reader: loadMemoryReader(PACK_CONTRACT), entry: "api.yaml" });

  return {
    formatVersion: 1,
    directories: DIRECTORY_CASES.map((spec) => directoryVector(base, integrity, spec)),
    archives: [
      archiveVector(
        "valid",
        "The bundle of the valid directory case, as the writer's tarball.",
        bundleTarball({
          ...contents,
          manifest: { ...contents.manifest, compiler: VECTOR_COMPILER },
        }),
      ),
      ...ARCHIVE_CASES.map((spec) =>
        archiveVector(spec.id, spec.description, rawTarball(spec.entries), spec.code),
      ),
    ],
  };
}
