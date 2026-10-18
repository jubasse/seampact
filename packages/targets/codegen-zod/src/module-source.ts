import { posix } from "node:path";
import { CODE_POINTS_MODULE, MODULE_EXTENSION } from "./layout.js";

// The name of the generated code point counter, the one helper the validators share.
export const CODE_POINT_LENGTH = "codePointLength";

// A module's declarations and what it imports beside zod.
export interface ModuleSource {
  declarations: readonly string[];
  usesCodePoints: boolean;
  namespaces: readonly { name: string; module: string }[];
}

// The counter module: a JavaScript string's `length` counts UTF-16 units, JSON Schema's lengths code points.
export const CODE_POINTS_SOURCE = `export function ${CODE_POINT_LENGTH}(value: string): number {\nreturn Array.from(value).length;\n}\n`;

// The file contents of a module, or undefined when it declares nothing.
export function moduleContents(module: string, source: ModuleSource): string | undefined {
  if (source.declarations.length === 0) return undefined;

  const imports = ['import { z } from "zod";'];

  if (source.usesCodePoints) {
    imports.push(
      `import { ${CODE_POINT_LENGTH} } from "${relativeSpecifier(module, CODE_POINTS_MODULE)}";`,
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
