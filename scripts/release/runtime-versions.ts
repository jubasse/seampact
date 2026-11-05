// The runtime side of the stamp: the version constant each runtime carries (ADR 0025, "Version guards"). The
// generate-time check and the boot check read these constants, never a manifest, so a runtime left at the
// development version refuses the code of the released generators.
import type { VersionEdit } from "./version-edit.ts";
import { lineVersionEdit } from "./version-edit.ts";

interface RuntimeConstant {
  readonly file: string;
  /** The text before the version, the version, the text after it. */
  readonly line: RegExp;
  readonly field: string;
}

export const RUNTIME_CONSTANTS: readonly RuntimeConstant[] = [
  {
    file: "packages/runtime/server-runtime/src/version.ts",
    line: /^(export const SERVER_RUNTIME_VERSION = ")([^"]*)(";)$/m,
    field: "SERVER_RUNTIME_VERSION",
  },
  {
    file: "python/codegen/src/seampact/codegen/runtime/version.py",
    line: /^(RUNTIME_VERSION: Final = ")([^"]*)(")$/m,
    field: "RUNTIME_VERSION",
  },
  {
    file: "php/codegen/runtime/RuntimeVersion.php",
    line: /^( {4}public const VERSION = ')([^']*)(';)$/m,
    field: "RuntimeVersion::VERSION",
  },
];

export function runtimeVersionEdits(root: string, version: string): VersionEdit[] {
  return RUNTIME_CONSTANTS.map((constant) =>
    lineVersionEdit(root, constant.file, constant.line, version, constant.field),
  );
}
