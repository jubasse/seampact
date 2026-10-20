import {
  BUNDLE_MANIFEST_BYTES_MAX,
  BUNDLE_MANIFEST_FILE,
  BUNDLE_MANIFEST_SCHEMA,
  type BundleFailure,
  type BundleManifest,
  bundleManifestRuleProblems,
} from "@seampact/spec/bundle";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parseUntrustedJson, utf8Text } from "./untrusted-json.js";

// The manifest as a verifier reads it: at most `BUNDLE_MANIFEST_BYTES_MAX` bytes of UTF-8 JSON with no reserved
// key, valid under `schemas/bundle/manifest.schema.json`, then under the rules no schema states.

// A refusal lists at most this many problems, then how many more there are.
const LISTED_PROBLEM_LIMIT = 5;

let manifestValidator: ValidateFunction<BundleManifest> | undefined;

// Compiling the schema takes a while: one validator serves the process.
function validator(): ValidateFunction<BundleManifest> {
  manifestValidator ??= new Ajv2020({ allErrors: true, strict: true }).compile<BundleManifest>(
    structuredClone(BUNDLE_MANIFEST_SCHEMA),
  );

  return manifestValidator;
}

/** The manifest of `bytes`, or the failure naming why it is refused. */
export function readBundleManifest(bytes: Uint8Array): BundleManifest | BundleFailure {
  if (bytes.length > BUNDLE_MANIFEST_BYTES_MAX) return manifestTooLarge(bytes.length);

  const text = utf8Text(bytes);

  if (text === undefined) return invalidManifest(["is not UTF-8 text"]);

  const parsed = parseUntrustedJson(text);

  if (!parsed.ok) return invalidManifest([parsed.problem]);

  const validate = validator();

  if (!validate(parsed.value))
    return invalidManifest(
      (validate.errors ?? []).map(
        (error) => `at '${error.instancePath}' ${error.message ?? error.keyword}`,
      ),
    );

  const manifest = parsed.value;
  const problems = bundleManifestRuleProblems(manifest);

  if (problems.length > 0)
    return invalidManifest(problems.map((problem) => `at '${problem.pointer}' ${problem.message}`));

  return manifest;
}

/** The failure of a manifest over `BUNDLE_MANIFEST_BYTES_MAX`, refused before it is read. */
export function manifestTooLarge(size: number): BundleFailure {
  return {
    code: "bundle.manifest-too-large",
    message: `'${BUNDLE_MANIFEST_FILE}' holds ${size} bytes, over the cap of ${BUNDLE_MANIFEST_BYTES_MAX}.`,
    fix: "Check that the source names a seampact bundle; a manifest this large is not one.",
    file: BUNDLE_MANIFEST_FILE,
    expected: String(BUNDLE_MANIFEST_BYTES_MAX),
    actual: String(size),
  };
}

function invalidManifest(problems: readonly string[]): BundleFailure {
  const listed = problems.slice(0, LISTED_PROBLEM_LIMIT);
  const more = problems.length - listed.length;

  return {
    code: "bundle.manifest-invalid",
    message: `'${BUNDLE_MANIFEST_FILE}' is not a valid manifest: ${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`,
    fix: "Download the bundle again, or rebuild it with `seampact bundle`.",
    file: BUNDLE_MANIFEST_FILE,
  };
}
