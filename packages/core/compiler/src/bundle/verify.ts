import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLE_ENTRIES_MAX,
  BUNDLE_EXTRACTED_BYTES_MAX,
  BUNDLE_MANIFEST_BYTES_MAX,
  BUNDLE_MANIFEST_FILE,
  type BundleFailure,
  type BundleManifest,
} from "@seampact/spec/bundle";
import type { ContractIR } from "@seampact/spec/ir";
import { quote } from "../validate/diagnostics.js";
import { bundleIntegrity, bundleSha256Hex } from "./integrity.js";
import { checkBundleIr } from "./ir-check.js";
import { manifestTooLarge, readBundleManifest } from "./manifest-read.js";

// The pinned-bundle check (ADR 0011), on a bundle directory, in order: (1) every listed file exists with its size
// and SHA-256, and no file is unlisted; (2) the integrity recomputed from the list equals the manifest's, then the
// pin; (3) each api's IR validates under the IR JSON Schema of its declared version, at this reader's exact
// irRevision before 1.0. A step runs only when the steps before it pass. Every failure names its file or its two
// values; a missing or differing pin also gives the actual integrity, so pinning is a copy.

/** How the bundle was fetched: an npm package root may also hold npm's own files (`package.json`, `README*`...). */
export type BundleChannel = "package" | "release" | "git";

export interface BundleVerifyOptions {
  readonly channel?: BundleChannel;
}

export type BundleVerifyResult =
  | {
      readonly ok: true;
      readonly manifest: BundleManifest;
      readonly integrity: string;
      /** Each api's IR by api name. */
      readonly irs: ReadonlyMap<string, ContractIR>;
    }
  | {
      readonly ok: false;
      readonly failures: readonly BundleFailure[];
      /** The recomputed integrity, once step 1 passed: the value to pin. */
      readonly integrity?: string;
    };

// Files npm adds to or keeps in every package, at the package root (npm's `files` rules).
const NPM_PACKAGE_MANIFEST = "package.json";
const NPM_ALWAYS_INCLUDED = /^(?:readme|license|licence|changelog)(?:[.-].*)?$/iu;

const REFETCH =
  "Fetch the bundle again from its source; if it fails again, the source holds a tampered bundle.";

/** Runs the three steps on the bundle at `directory` against the pinned integrity (undefined: no pin). */
export function verifyBundle(
  directory: string,
  pinnedIntegrity: string | undefined,
  options: BundleVerifyOptions = {},
): BundleVerifyResult {
  const walked = walkBundle(directory);

  if (!(walked instanceof Map)) return { ok: false, failures: [walked] };

  const manifestSize = walked.get(BUNDLE_MANIFEST_FILE);

  if (manifestSize === undefined)
    return {
      ok: false,
      failures: [
        {
          code: "bundle.manifest-missing",
          message: `The bundle has no '${BUNDLE_MANIFEST_FILE}' at its root.`,
          fix: "Check that the source names a seampact bundle (`seampact bundle` writes the manifest).",
          file: BUNDLE_MANIFEST_FILE,
        },
      ],
    };

  if (manifestSize > BUNDLE_MANIFEST_BYTES_MAX)
    return { ok: false, failures: [manifestTooLarge(manifestSize)] };

  const manifest = readBundleManifest(
    new Uint8Array(readFileSync(join(directory, BUNDLE_MANIFEST_FILE))),
  );

  if ("code" in manifest) return { ok: false, failures: [manifest] };

  const files = checkFiles(directory, manifest, walked, options.channel);

  if (!(files instanceof Map)) return { ok: false, failures: files };

  const integrity = bundleIntegrity(manifest.files);
  const integrityFailure = checkIntegrity(manifest, integrity, pinnedIntegrity);

  if (integrityFailure !== undefined) return { ok: false, failures: [integrityFailure], integrity };

  const irs = new Map<string, ContractIR>();
  const irFailures: BundleFailure[] = [];

  for (const api of manifest.apis) {
    const bytes = files.get(api.file);

    // The manifest rules list every api's file, and step 1 read every listed file.
    if (bytes === undefined)
      throw new Error(`bundle: the checked file '${api.file}' of api '${api.name}' was not read.`);

    const checked = checkBundleIr(api, bytes);

    if ("code" in checked) irFailures.push(checked);
    else irs.set(api.name, checked);
  }

  if (irFailures.length > 0) return { ok: false, failures: irFailures, integrity };

  return { ok: true, manifest, integrity, irs };
}

// Every regular file under `directory` with its size, by POSIX path; a link or special file, or a bundle over the
// caps, is the failure.
function walkBundle(directory: string): Map<string, number> | BundleFailure {
  const sizes = new Map<string, number>();
  const pending: string[] = [""];
  let total = 0;

  for (let relative = pending.pop(); relative !== undefined; relative = pending.pop()) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }

      if (!entry.isFile())
        return {
          code: "bundle.file-type",
          message: `${quote(path)} is a link or a special file; a bundle holds regular files only.`,
          fix: REFETCH,
          file: path,
        };

      sizes.set(path, lstatSync(join(directory, path)).size);
      total += sizes.get(path) ?? 0;

      if (sizes.size > BUNDLE_ENTRIES_MAX || total > BUNDLE_EXTRACTED_BYTES_MAX)
        return overCap(sizes.size, total);
    }
  }

  return sizes;
}

function overCap(fileCount: number, total: number): BundleFailure {
  if (fileCount > BUNDLE_ENTRIES_MAX)
    return {
      code: "bundle.too-many-files",
      message: `The bundle holds more than ${BUNDLE_ENTRIES_MAX} files.`,
      fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
      expected: String(BUNDLE_ENTRIES_MAX),
    };

  return {
    code: "bundle.too-large",
    message: `The bundle's files hold more than ${BUNDLE_EXTRACTED_BYTES_MAX} bytes (${total} so far).`,
    fix: "Check that the source names a seampact bundle; a bundle this large is not one.",
    expected: String(BUNDLE_EXTRACTED_BYTES_MAX),
  };
}

// Step 1: the bytes of every listed file, or every file failure in path order (listed files, then unlisted ones).
function checkFiles(
  directory: string,
  manifest: BundleManifest,
  walked: ReadonlyMap<string, number>,
  channel: BundleChannel | undefined,
): Map<string, Uint8Array> | BundleFailure[] {
  const failures: BundleFailure[] = [];
  const bytesByPath = new Map<string, Uint8Array>();

  for (const file of manifest.files) {
    const size = walked.get(file.path);

    if (size === undefined) {
      failures.push({
        code: "bundle.file-missing",
        message: `'${file.path}' is listed in the manifest and missing from the bundle.`,
        fix: REFETCH,
        file: file.path,
      });
      continue;
    }

    if (size !== file.size) {
      failures.push({
        code: "bundle.file-size",
        message: `'${file.path}' holds ${size} bytes; the manifest lists ${file.size}.`,
        fix: REFETCH,
        file: file.path,
        expected: String(file.size),
        actual: String(size),
      });
      continue;
    }

    const bytes = new Uint8Array(readFileSync(join(directory, ...file.path.split("/"))));
    const sha256 = bundleSha256Hex(bytes);

    if (sha256 !== file.sha256) {
      failures.push({
        code: "bundle.file-hash",
        message: `'${file.path}' has the SHA-256 ${sha256}; the manifest lists ${file.sha256}.`,
        fix: REFETCH,
        file: file.path,
        expected: file.sha256,
        actual: sha256,
      });
      continue;
    }

    bytesByPath.set(file.path, bytes);
  }

  const listed = new Set(manifest.files.map((file) => file.path));
  const unlisted = [...walked.keys()]
    .filter(
      (path) => path !== BUNDLE_MANIFEST_FILE && !listed.has(path) && !isNpmFile(path, channel),
    )
    .sort();

  for (const path of unlisted)
    failures.push({
      code: "bundle.file-unlisted",
      message: `${quote(path)} is in the bundle and not listed in the manifest.`,
      fix: REFETCH,
      file: path,
    });

  return failures.length > 0 ? failures : bytesByPath;
}

function isNpmFile(path: string, channel: BundleChannel | undefined): boolean {
  if (channel !== "package" || path.includes("/")) return false;

  return path === NPM_PACKAGE_MANIFEST || NPM_ALWAYS_INCLUDED.test(path);
}

// Step 2: the manifest's integrity against the recomputed one, then the pin against both.
function checkIntegrity(
  manifest: BundleManifest,
  integrity: string,
  pinnedIntegrity: string | undefined,
): BundleFailure | undefined {
  if (manifest.integrity !== integrity)
    return {
      code: "bundle.integrity-mismatch",
      message: `The manifest's integrity is ${manifest.integrity}; its file list gives ${integrity}.`,
      fix: REFETCH,
      file: BUNDLE_MANIFEST_FILE,
      expected: manifest.integrity,
      actual: integrity,
    };

  if (pinnedIntegrity === undefined)
    return {
      code: "bundle.pin-missing",
      message: `The bundle source pins no integrity; the bundle's is ${integrity}.`,
      fix: `Review the bundle, then pin it: integrity: ${integrity}`,
      actual: integrity,
    };

  if (pinnedIntegrity !== integrity)
    return {
      code: "bundle.pin-mismatch",
      message: `The pinned integrity is ${pinnedIntegrity}; the bundle's is ${integrity}.`,
      fix: `Fetch the bundle the pin names, or review this one and pin it: integrity: ${integrity}`,
      expected: pinnedIntegrity,
      actual: integrity,
    };

  return undefined;
}
