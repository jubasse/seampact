import { posix } from "node:path";
import type { ExportRef } from "./descriptors.js";
import type { Link } from "./links.js";

// Resolves under NodeNext, bundler and CommonJS resolution alike.
const MODULE_SUFFIX = ".js";

// The specifier a file at `fromFile` (relative to the consumer's output root) imports `exportRef` with: a POSIX
// relative path to the provider's module, or the link's explicit module specifier followed by the module path.
export function importSpecifier(link: Link, exportRef: ExportRef, fromFile: string): string {
  if (link.location.kind === "module") {
    return `${link.location.specifier}/${exportRef.module}${MODULE_SUFFIX}`;
  }

  const providerModule = posix.join(link.location.path, exportRef.module);
  const relativeModule = posix.relative(posix.dirname(fromFile), providerModule);
  const dotted = relativeModule.startsWith("../") ? relativeModule : `./${relativeModule}`;

  return `${dotted}${MODULE_SUFFIX}`;
}
