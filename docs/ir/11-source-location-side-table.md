### 11. The source-location side table

Source locations live in a separate document, written next to the IR when asked (`compile --source-map`) and never inside it:

```ts
interface SourceMap {
  irRevision: number;
  locations: Record<string, { file: string; line: number; column: number; endLine: number; endColumn: number }>;
}
```

Keys are `"<layer>#<pointer>"`, the serialised form of an `Origin`. `file` is relative to the workspace root, with forward slashes. Every pass, lint and the CLI turn an origin into `file:line:col` through this table, so diagnostics stay located after the IR is built (FR-1). A pack origin maps to the pack's own file inside its package or bundle. Its `file` is `.packs/<name>@<version>/<path inside the pack>`, the path the bundle vendors it under, wherever the package manager installed the pack. A `core` origin has no entry, and the key pattern refuses one: a core declaration has no file, so a diagnostic about it is located at the binding or use that pulled it in (section 6).
