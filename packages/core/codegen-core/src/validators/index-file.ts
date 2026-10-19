import { apiIndexSource, type IndexedModule } from "../api-index.js";
import type { GeneratedFile } from "../target.js";
import {
  INDEX_MODULE,
  OPERATION_INPUT_MODULE,
  SCHEMA_MODULES,
  SCHEMA_NAMESPACES,
} from "./layout.js";
import { modulePath } from "./module-source.js";

// The api index: each schema module under its direction's namespace, the operation input validators flat, so
// `import * as Tasks from "<out>/index.js"` reaches every name; `wire-checks` stays internal.
export function indexFile(files: readonly GeneratedFile[]): GeneratedFile[] {
  const written = new Set(files.map((file) => file.path));
  const schemaModules = (["input", "output"] as const).flatMap((direction) =>
    written.has(modulePath(SCHEMA_MODULES[direction]))
      ? [{ module: SCHEMA_MODULES[direction], namespace: SCHEMA_NAMESPACES[direction] }]
      : [],
  );
  const operationModules = written.has(modulePath(OPERATION_INPUT_MODULE))
    ? [{ module: OPERATION_INPUT_MODULE }]
    : [];
  const modules: IndexedModule[] = [...schemaModules, ...operationModules];

  if (modules.length === 0) return [];

  return [{ path: modulePath(INDEX_MODULE), contents: apiIndexSource(modules) }];
}
