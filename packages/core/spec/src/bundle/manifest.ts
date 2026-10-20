import manifestSchema from "../../schemas/bundle/manifest.schema.json" with { type: "json" };

// The bundle manifest (ADR 0011 "The bundle"): `seampact-bundle.json` at the bundle root. Its JSON Schema,
// `schemas/bundle/manifest.schema.json`, is what the Kotlin, PHP, .NET and Python readers check; these types
// mirror it, and a test holds the two together.

/** The format version this package writes and reads; a reader refuses another. */
export const BUNDLE_FORMAT_VERSION = 1;

/** The manifest's file name, at the bundle root. */
export const BUNDLE_MANIFEST_FILE = "seampact-bundle.json";

/** The directory of the sources as authored, and of the vendored packs below it (ADR 0008). */
export const BUNDLE_SOURCES_DIRECTORY = "sources";
export const BUNDLE_PACKS_DIRECTORY = `${BUNDLE_SOURCES_DIRECTORY}/.packs`;

/** The directory of the canonical IR of each api, `ir/<api>.json`. */
export const BUNDLE_IR_DIRECTORY = "ir";

export const BUNDLE_MANIFEST_SCHEMA_ID = "https://seampact.dev/schemas/bundle/manifest.schema.json";

/** The manifest's JSON Schema document (draft 2020-12). */
export const BUNDLE_MANIFEST_SCHEMA: { readonly [keyword: string]: unknown } = manifestSchema;

export interface BundleNamedVersion {
  readonly name: string;
  readonly version: string;
}

export interface BundleApi {
  readonly name: string;
  /** `ir/<name>.json`. */
  readonly file: string;
  readonly irVersion: number;
  readonly irRevision: number;
}

export interface BundleFile {
  /** A portable path (`bundlePathProblem`). */
  readonly path: string;
  readonly size: number;
  /** Lowercase hexadecimal. */
  readonly sha256: string;
}

export interface BundleManifest {
  readonly formatVersion: typeof BUNDLE_FORMAT_VERSION;
  readonly contract: BundleNamedVersion;
  readonly apis: readonly BundleApi[];
  readonly compiler: BundleNamedVersion;
  readonly packs: readonly BundleNamedVersion[];
  /** Every file but the manifest, sorted by path in code-unit order. */
  readonly files: readonly BundleFile[];
  /** `sha256-` and the padded standard base64 of the SHA-256 of `canonicalBundleFileList(files)`. */
  readonly integrity: string;
}
