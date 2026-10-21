// A module the api index re-exports: all of it flat, all of it under a namespace, or a listed set of names.
export type IndexedModule =
  | { module: string; namespace?: string }
  | { module: string; typeNames: readonly string[]; valueNames: readonly string[] };

const MODULE_SUFFIX = ".js";

// The source of an api's `index.ts`. `module` is a path without extension relative to the index. A role whose names
// repeat another module's goes under a namespace named by its role; a module with internals lists its public names,
// an empty list writing no line.
export function apiIndexSource(modules: readonly IndexedModule[]): string {
  const lines = modules.map(indexLine);

  return `${lines.join("\n")}\n`;
}

function indexLine(indexed: IndexedModule): string {
  const specifier = `./${indexed.module}${MODULE_SUFFIX}`;

  if ("typeNames" in indexed) {
    const lines = [
      ...(indexed.typeNames.length === 0
        ? []
        : [`export type { ${indexed.typeNames.join(", ")} } from "${specifier}";`]),
      ...(indexed.valueNames.length === 0
        ? []
        : [`export { ${indexed.valueNames.join(", ")} } from "${specifier}";`]),
    ];

    return lines.join("\n");
  }

  return indexed.namespace === undefined
    ? `export * from "${specifier}";`
    : `export * as ${indexed.namespace} from "${specifier}";`;
}
