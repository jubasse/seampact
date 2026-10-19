// The names a generated module takes from class-validator and class-transformer, recorded as its decorators are
// rendered, and the import lines that bring them in.
export class LibraryImports {
  private readonly validatorNames = new Set<string>();
  private readonly transformerNames = new Set<string>();

  validator(name: string): string {
    this.validatorNames.add(name);

    return name;
  }

  transformer(name: string): string {
    this.transformerNames.add(name);

    return name;
  }

  // An empty string when the module uses neither library.
  importLines(): string {
    return [
      importLine(this.transformerNames, "class-transformer"),
      importLine(this.validatorNames, "class-validator"),
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}

function importLine(names: ReadonlySet<string>, module: string): string {
  if (names.size === 0) return "";

  return `import { ${[...names].sort().join(", ")} } from "${module}";`;
}
