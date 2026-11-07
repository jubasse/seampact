import { compareBundlePaths } from "./file-list.js";
import { BUNDLE_IR_DIRECTORY, type BundleManifest } from "./manifest.js";
import { bundlePathFold } from "./path.js";

// The manifest rules no JSON Schema states, checked after the schema: files strictly sorted by path in code-unit
// order, so no path is listed twice; no two paths equal once folded to ASCII lower case (they would be one file on
// a case-insensitive file system); each api named once, its file `ir/<name>.json` and listed; every `ir/` file an
// api's; packs sorted by name then version, none twice.

export interface BundleManifestProblem {
  /** A JSON Pointer into the manifest. */
  readonly pointer: string;
  readonly message: string;
}

/** Every rule a schema-valid manifest breaks, in manifest order. */
export function bundleManifestRuleProblems(manifest: BundleManifest): BundleManifestProblem[] {
  return [...fileProblems(manifest), ...apiProblems(manifest), ...packProblems(manifest)];
}

function fileProblems(manifest: BundleManifest): BundleManifestProblem[] {
  const problems: BundleManifestProblem[] = [];
  const pathByFold = new Map<string, string>();

  manifest.files.forEach((file, index) => {
    const pointer = `/files/${index}/path`;
    const previous = manifest.files[index - 1]?.path;

    if (previous === file.path)
      problems.push({ pointer, message: `'${file.path}' is listed twice` });
    else if (previous !== undefined && compareBundlePaths(previous, file.path) > 0)
      problems.push({
        pointer,
        message: `'${file.path}' is listed after '${previous}'; sort the files by path`,
      });

    const folded = bundlePathFold(file.path);
    const sameFold = pathByFold.get(folded);

    if (sameFold !== undefined && sameFold !== file.path)
      problems.push({
        pointer,
        message: `'${file.path}' differs from '${sameFold}' only in letter case`,
      });

    pathByFold.set(folded, file.path);
  });

  return problems;
}

function apiProblems(manifest: BundleManifest): BundleManifestProblem[] {
  const problems: BundleManifestProblem[] = [];
  const listed = new Set(manifest.files.map((file) => file.path));
  const apiFiles = new Set<string>();
  const names = new Set<string>();

  manifest.apis.forEach((api, index) => {
    const expectedFile = `${BUNDLE_IR_DIRECTORY}/${api.name}.json`;

    if (names.has(api.name))
      problems.push({
        pointer: `/apis/${index}/name`,
        message: `the api '${api.name}' is listed twice`,
      });

    if (api.file !== expectedFile)
      problems.push({
        pointer: `/apis/${index}/file`,
        message: `the file of api '${api.name}' is '${api.file}', not '${expectedFile}'`,
      });
    else if (!listed.has(api.file))
      problems.push({ pointer: `/apis/${index}/file`, message: `'${api.file}' is not in files` });

    names.add(api.name);
    apiFiles.add(api.file);
  });

  manifest.files.forEach((file, index) => {
    if (file.path.startsWith(`${BUNDLE_IR_DIRECTORY}/`) && !apiFiles.has(file.path))
      problems.push({
        pointer: `/files/${index}/path`,
        message: `'${file.path}' is not the file of any api`,
      });
  });

  return problems;
}

function packProblems(manifest: BundleManifest): BundleManifestProblem[] {
  const problems: BundleManifestProblem[] = [];

  manifest.packs.forEach((pack, index) => {
    const previous = manifest.packs[index - 1];

    if (previous === undefined) return;

    const order =
      compareBundlePaths(previous.name, pack.name) ||
      compareBundlePaths(previous.version, pack.version);

    if (order >= 0)
      problems.push({
        pointer: `/packs/${index}`,
        message: `the pack '${pack.name}@${pack.version}' is listed twice or out of order; sort the packs by name then version`,
      });
  });

  return problems;
}
