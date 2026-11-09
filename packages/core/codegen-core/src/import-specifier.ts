import { posix } from "node:path";
import type { ExportRef } from "./descriptors.js";
import type { Link } from "./links.js";

/**
 * How a generated relative import names its module: `js` with the suffix that resolves under NodeNext, bundler and
 * CommonJS resolution alike, or `extensionless` for a bundler that does not map a `.js` specifier to its `.ts`
 * source (Next.js under Turbopack), resolved with `moduleResolution: bundler`.
 */
export type ImportSpecifierStyle = "js" | "extensionless";

export const DEFAULT_IMPORT_SPECIFIER_STYLE: ImportSpecifierStyle = "js";

const MODULE_SUFFIXES: Readonly<Record<ImportSpecifierStyle, string>> = {
  js: ".js",
  extensionless: "",
};

// A package subpath resolves through the package's own exports, whatever the style.
const PACKAGE_MODULE_SUFFIX = MODULE_SUFFIXES.js;

// The specifier a file at `fromFile` (relative to the consumer's output root) imports `exportRef` with: a POSIX
// relative path to the provider's module in `style`, or the link's explicit module specifier followed by the module
// path.
export function importSpecifier(
  link: Link,
  exportRef: ExportRef,
  fromFile: string,
  style: ImportSpecifierStyle = DEFAULT_IMPORT_SPECIFIER_STYLE,
): string {
  if (link.location.kind === "module") {
    return `${link.location.specifier}/${exportRef.module}${PACKAGE_MODULE_SUFFIX}`;
  }

  return relativeModuleSpecifier(fromFile, posix.join(link.location.path, exportRef.module), style);
}

// The POSIX relative specifier a file at `fromFile` imports the module `toModule` with, both relative to one root.
export function relativeModuleSpecifier(
  fromFile: string,
  toModule: string,
  style: ImportSpecifierStyle = DEFAULT_IMPORT_SPECIFIER_STYLE,
): string {
  const relativeModule = posix.relative(posix.dirname(fromFile), toModule);
  const dotted = relativeModule.startsWith("../") ? relativeModule : `./${relativeModule}`;

  return `${dotted}${MODULE_SUFFIXES[style]}`;
}
