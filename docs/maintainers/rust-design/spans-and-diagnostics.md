# Rust design: spans and diagnostics

How every 2.0.0 layer records where a value came from and reports a problem about it. It applies [PORTING.md](../../../PORTING.md) sections 2 and 3 to the TypeScript `packages/core/compiler/src/diagnostics/` and to the positions the loader writes (`load/source.ts`, `siteOf` over the `yaml` package's `LineCounter`). The [IR and authoring types](ir-and-authoring-types.md) note uses these types in its locations side table (its section 7). A port lane uses them as given; a gap goes to the lead.

## 1. Crates

| Crate | Directory | Holds | Depends on |
|---|---|---|---|
| `seampact-span` | `crates/span` | `FileId`, `Span`, the file table `SourceFiles`, text normalisation, `Location` and the byte to line and UTF-16 column conversion | `text-size`, `line-index` |
| `seampact-diagnostics` | `crates/diagnostics` | `Diagnostic` and its parts, `RuleId`, `Severity`, the sink, the location key, the sort, the printer, the inert-text escape, the mapping-keys hint, the internal error and the exit codes | `seampact-span`, `seampact-js` |

- Two crates, because the authoring tree needs spans and no diagnostic type, and the printer needs the file table and no tree: the loaded tree depends on `seampact-span` only.
- Neither crate depends on `seampact-ir` or `seampact-json`. The diagnostic origin is its own type (section 3), so the seam lands first and the IR lane is not blocked on it, nor this one on the IR.

## 2. Spans and the file table

- **`FileId(u32)`**: an index into `SourceFiles`, given in load order. A `u32` because the load budget keeps a run far below 2^32 files.
- **`Span { file: FileId, range: TextRange }`**: byte offsets into the file's normalised text, with `text-size`'s `TextRange` (`u32` offsets, the type `line-index` takes). Byte offsets slice the stored text with no conversion, so they cost nothing until a position is printed.
- **`SourceFiles`**: `add(path, raw_text) -> FileId` and `get(FileId) -> Option<&SourceFile>`. `SourceFile` owns the workspace-relative path (the TypeScript `file` string), the normalised text and its `LineIndex`. A lookup of an unknown id is `None`, never a made-up file.
- **Normalisation in the table.** `SourceFile::new` applies the loader's `normalizeText` (strip one leading U+FEFF, then `\r\n` and a lone `\r` to `\n`) before indexing. The TypeScript computes every position on that text, and doing it here makes a span into the raw text unrepresentable. The loader lane calls it instead of porting `normalizeText`.
- **Line and column at the edge.** `SourceFiles::location(span) -> Option<Location>` ports `siteOf`: the start and `max(start, end)` each become a 1-based line and a 1-based UTF-16 column, through `line-index` (`try_line_col`, then `to_wide(Utf16)`). This reproduces `LineCounter.linePos`, whose line starts are 0 and the offset after each `\n` of the text. A tab counts one unit, an astral character two, a position at the end of a last line without a newline is its length plus one, and offset 0 of an empty file is `1:1`.
- **`Location { file, line, column, end_line, end_column }`**: the TypeScript `SiteLocation`, the record of `SourceMap.locations`. Lines and columns are `u32`. The IR's source-map type uses this record (an item for the IR lane, section 9).
- Offsets that leave the text or split a character give `None`: a broken span is a bug the caller reports as an internal error (section 6), never a position near it.

## 3. The diagnostic

```rust
pub struct Diagnostic {
    pub severity: Severity,               // Error | Warning; Display "error" | "warning"
    pub rule: RuleId,                     // "seampact/<stage>/<rule>"
    pub message: String,
    pub fix: String,
    pub origin: DiagnosticOrigin,
    pub related: Vec<RelatedLocation>,    // { origin, message }
}

pub struct DiagnosticOrigin { pub api: Option<String>, pub layer: DiagnosticLayer, pub pointer: String }
pub enum DiagnosticLayer { Api, Shared, Base, Workspace, Pack(String) }
```

- Same members as `diagnostic.ts`, which ADR 0006 section 4 fixes and the oracle's `diagnostics.json` holds.
- `DiagnosticLayer` has no `Core` variant: the TypeScript `Exclude<..., "core">` becomes a type that cannot hold it. Its text is `api`, `shared`, `base`, `workspace` or `pack:<name>`; a pack name is any text (`pack:./p.yaml` is in the fixtures). The pipeline lane converts an `ir::Origin` with a function that returns `None` for `core`, as each TypeScript `report.ts` does with `isDiagnosticOrigin`.
- `api` stays: an origin copied from a relayed api carries it into `diagnostics.json` (`rules/tree-relay-declaration`). The location key ignores it.
- `pointer` is a `String`, not the JSON crate's pointer type: a load site pointer (`/~load/<file>/<line>/<column>`) points into no tree, and the key is built from the escaped text.
- **`RuleId(Cow<'static, str>)`**: a newtype, so a rule id and a message never swap. A stage declares its ids as `const` values (`RuleId::from_static`); the load stage and lint plugins build theirs at run time (`RuleId::new`).
- Every type is plain owned data, `Send + Sync`, asserted at compile time.

## 4. The sink

- `DiagnosticSink` wraps a `Vec<Diagnostic>`: `report(diagnostic)`, `error_count()`, `len()`, `into_diagnostics()`. A pass gets `&mut DiagnosticSink` through its context, as the TypeScript `PassContext.report` pushes onto one array per api.
- Emit order is kept; the order users see comes from `diagnostic_sort` at the edge (the loader's result, each api's result, the lint run), as in the TypeScript. A stable sort keeps the emit order on a full tie.
- One sink per api and one for the workspace. Apis run in parallel each own their sink, merged in api order afterwards; no lock, no `Arc` (IR note section 4).
- Deduplication (the loader's `seen` set) and relabelling stay in the loader's reporter, which owns its sink.

## 5. Messages, fixes and the catalogue

- The TypeScript has no catalogue: rule ids are per-stage string unions (`AccessIdentityRule`, `validateRules`) and about 600 template literals build messages at the report site.
- The port keeps that per stage: each stage's `report` module holds a rule enum whose variants map to `RuleId` constants, and one function per message that takes the typed values and returns its message and fix. Passes call those functions, so no format string sits in a pass body, and each stage's text is in one file the oracle compares.
- The validate stage's messages come from its own catalogue instead of ajv (ADR 0031); its lane writes it.
- This crate holds only what every stage shares: `mapping_keys_hint` (the tail of a fix that asks for a mapping) and the sentence rules of the printer.

## 6. Bugs: the internal error and the exit code

- `InternalError { what: String, location: &'static Location<'static> }` (`std::panic::Location` from `#[track_caller]`) is the `Err` of a function whose failure can only be a bug: a broken span, a missing table entry the code put there. It goes up with `?` to the driver, never into a sink.
- The CLI prints it as one line, `internal error: <what> at <file>:<line>. Fix: report it with the seampact version.`, and exits with `EXIT_INTERNAL = 3`. `EXIT_SUCCESS = 0`, `EXIT_REFUSED = 1` and `EXIT_USAGE = 2` keep the TypeScript values; the native channels already read any other exit as `binary.compile-failed` (ADR 0010).
- A user fault is never an `InternalError`; an environment failure is the crate's `thiserror` enum (PORTING section 3).

## 7. Order and printed form

- `diagnostic_location_key(origin)` is `"<layer>#<pointer>"`. `diagnostic_location(origin, locations)` looks the key up in an `IndexMap<String, Location>` and gives `(unknown location):0:0` when absent, as the TypeScript does.
- The authoring side table maps keys to `Span`; `SourceFiles::locations` turns it into the `Location` table once, before sorting, printing or writing the source map. One printer then serves the loader, the passes and lint.
- `diagnostic_sort`: file, line, column, rule, then message; strings in UTF-16 order (`cmp_utf16`), numbers numerically, stable.
- `print_diagnostics` is plain code, a line for line port of `print.ts`. `annotate-snippets` prints snippets and carets the TypeScript output does not have, so it would change every printed byte; it is not used.
- `diagnostic_inert` escapes Cc, Cf, Zl and Zp characters as `\uXXXX` (`\u{XXXXX}` beyond the basic plane). A Rust string holds no lone surrogate, so the `Cs` arm has nothing to match. The categories are a table checked over every code point against `regress` (`\p{Cc}` and the others) in a test, so no run-time regex can fail to compile.
- `sentence` collapses ECMAScript white space (`\s`) to one space, trims, escapes, and adds a period unless the text ends with `.`, `!` or `?`. The white-space set is the ECMAScript one, checked against `regress` `\s` over every code point.

## 8. Tests

- Positions: an astral character, a CRLF file, a lone CR, a BOM, a tab, the last line without a newline, an empty file, an end before the start, an offset past the end or inside a character.
- The behaviours of `print.test.ts` and `diagnostic.test.ts` (the core layer is a compile error, so it needs no run-time test).
- Order and printed text: every loader fixture with an `expected.txt` whose diagnostics are all at load sites. The test reads `fixtures/expected/<fixture>/diagnostics.json`, builds the location table from the site pointers, sorts the reversed list, and compares the order with the file and the printed lines with `expected.txt`.

## 9. Out of scope

- The loader: reading files, YAML events, the site pointer, deduplication and relabelling. It fills `SourceFiles` and the span side table; the loader lane.
- The per-stage rule enums and message functions: each stage's port lane, in its own crate.
- The IR source-map type: the IR lane, which uses `Location` from `seampact-span` or converts from it.
- The CLI output module that writes printed diagnostics and internal errors to stderr: the CLI lane.
