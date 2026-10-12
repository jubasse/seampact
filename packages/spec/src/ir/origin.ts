// ADR 0004 section 6
export interface Origin {
  api?: string;
  layer: "api" | "shared" | "base" | `pack:${string}`;
  pointer: string;
}

// ADR 0004 section 11
export interface SourceMap {
  irRevision: number;
  locations: Record<
    string,
    { file: string; line: number; column: number; endLine: number; endColumn: number }
  >;
}
