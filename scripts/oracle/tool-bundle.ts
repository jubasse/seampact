import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import type { OracleTools } from "./tool-modules.ts";

// A bundle case: `buildBundle` over a workspace, then the files the manifest lists, the manifest's bytes, the
// integrity and the entries of the tarball (`bundle/files.json`, `manifest.json`, `integrity.txt`, `ustar.json`), or
// the failures (`bundle/refusals.json`).

export interface BundleSpec {
  workspace?: string;
  name?: string;
  version?: string;
}

const BLOCK = 512;
const MANIFEST_FILE = "seampact-bundle.json";
const OCTAL = 8;

const textField = (block: Uint8Array, offset: number, length: number): string =>
  Buffer.from(block.subarray(offset, offset + length))
    .toString("utf8")
    .replace(/\0.*$/s, "");

const octalField = (block: Uint8Array, offset: number, length: number): number =>
  Number.parseInt(textField(block, offset, length).trim() || "0", OCTAL);

/** The entries of an uncompressed ustar archive, in order. */
function ustarEntries(archive: Uint8Array): object[] {
  const entries: object[] = [];
  let offset = 0;

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);

    if (header.every((byte) => byte === 0)) break;

    const name = textField(header, 0, 100);
    const prefix = textField(header, 345, 155);
    const size = octalField(header, 124, 12);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const content = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    // The manifest's size and hash change with the compiler member, which the integrity does not cover.
    const isManifest = path === MANIFEST_FILE;

    entries.push({
      path,
      ...(isManifest ? {} : { size }),
      mode: octalField(header, 100, 8),
      uid: octalField(header, 108, 8),
      gid: octalField(header, 116, 8),
      mtime: octalField(header, 136, 12),
      type: textField(header, 156, 1),
      uname: textField(header, 265, 32),
      gname: textField(header, 297, 32),
      ...(isManifest ? {} : { sha256: createHash("sha256").update(content).digest("hex") }),
    });
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

/** The bundle of the workspace `entry` in `root`; the name and version over its `package.json`. */
export function bundleFiles(
  tools: OracleTools,
  root: string,
  entry: string,
  spec: BundleSpec,
): ExpectedFiles {
  const contract = {
    ...(spec.name === undefined ? {} : { name: spec.name }),
    ...(spec.version === undefined ? {} : { version: spec.version }),
  };
  const outcome = tools.buildBundle({
    reader: tools.loadFsReader(root),
    entry,
    contract,
  });

  if (!outcome.ok) return new Map([["bundle/refusals.json", jsonText(outcome.failures)]]);

  const { contents } = outcome;
  const archive = gunzipSync(tools.bundleTarball(contents));

  return new Map([
    ["bundle/files.json", jsonText(contents.manifest.files)],
    [
      "bundle/manifest.json",
      Buffer.from(tools.bundleManifestBytes(contents.manifest)).toString("utf8"),
    ],
    ["bundle/integrity.txt", `${contents.manifest.integrity}\n`],
    ["bundle/ustar.json", jsonText(ustarEntries(archive))],
  ]);
}
