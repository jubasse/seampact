import type { ModuleSource, RulesMode, WireCheck } from "@seampact/codegen-core/validators";

// How a module refers to a schema validator, to a generated check and to the shared support, so it can import
// what it uses, and which rules it renders.
export interface YupRenderContext {
  readonly rules: RulesMode;
  referToSchema(schemaId: string, exportName: string): string;
  wireCheck(check: WireCheck): string;
  supportName(name: string): string;
}

// What one module being written uses, recorded as its declarations are rendered.
export class ModuleRendering implements YupRenderContext {
  readonly wireChecks = new Set<WireCheck>();
  readonly supportNames = new Set<string>();
  readonly namespaces: { name: string; module: string }[] = [];

  constructor(
    readonly rules: RulesMode,
    private readonly schemaReference: (schemaId: string, exportName: string) => string,
  ) {}

  referToSchema(schemaId: string, exportName: string): string {
    return this.schemaReference(schemaId, exportName);
  }

  wireCheck(check: WireCheck): string {
    this.wireChecks.add(check);

    return check;
  }

  supportName(name: string): string {
    this.supportNames.add(name);

    return name;
  }

  source(declarations: readonly string[]): ModuleSource {
    return { declarations, wireChecks: this.wireChecks, namespaces: this.namespaces };
  }
}
