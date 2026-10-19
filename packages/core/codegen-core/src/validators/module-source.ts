import { posix } from "node:path";
import { MODULE_EXTENSION, WIRE_CHECKS_MODULE } from "./layout.js";
import type { WireCheck } from "./wire-checks.js";

// A module's declarations and what it imports beside its validator library.
export interface ModuleSource {
  declarations: readonly string[];
  wireChecks: ReadonlySet<WireCheck>;
  namespaces: readonly { name: string; module: string }[];
}

// The file contents of a module, its validator library import first, or undefined when it declares nothing.
export function moduleContents(
  module: string,
  source: ModuleSource,
  libraryImport: string,
): string | undefined {
  if (source.declarations.length === 0) return undefined;

  const imports = [libraryImport];

  if (source.wireChecks.size > 0) {
    imports.push(
      `import { ${[...source.wireChecks].sort().join(", ")} } from "${relativeSpecifier(module, WIRE_CHECKS_MODULE)}";`,
    );
  }

  for (const namespace of source.namespaces) {
    imports.push(
      `import * as ${namespace.name} from "${relativeSpecifier(module, namespace.module)}";`,
    );
  }

  return `${[imports.join("\n"), ...source.declarations].join("\n\n")}\n`;
}

export function modulePath(module: string): string {
  return `${module}${MODULE_EXTENSION}`;
}

function relativeSpecifier(fromModule: string, toModule: string): string {
  const relative = posix.relative(posix.dirname(fromModule), toModule);
  const dotted = relative.startsWith("../") ? relative : `./${relative}`;

  return `${dotted}.js`;
}
