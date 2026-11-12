# Rust design: the loader and the pass pipeline

The first port layer of 2.0.0: the load stage (`packages/core/compiler/src/load/`), the pass pipeline (`pipeline/`) and the derivation table it reads (`derivations/`). It applies [PORTING.md](../../../PORTING.md) and [ADR 0006](../../adr/0006-compiler-pass-pipeline.md) on top of the [IR and authoring types](ir-and-authoring-types.md) and the [spans and diagnostics](spans-and-diagnostics.md) notes. A port lane uses these shapes as given; a gap goes to the lead, not into a local variant. The evidence for each choice that depends on a crate is in "Spike evidence".

## 1. Crates

| Crate | Directory | Holds | Depends on |
|---|---|---|---|
| `seampact-load` | `crates/load` | the load stage: the reader, paths and pack files, limits and the budget, the reporter, the YAML tree over `saphyr-parser` and the plain-scalar resolver, the file store, the schema positions, expand, compose, the loader entry | `seampact-authoring`, `seampact-span`, `seampact-diagnostics`, `seampact-json`, `seampact-js`, `seampact-ir`, `saphyr-parser`, `serde_json`, `indexmap`, `regress`, `camino` |
| `seampact-pipeline` | `crates/pipeline` | the half names, the derivation table, the draft, the half outputs and their merge, the half context, the inherited settings, the conventions, the tree-node model, the units, the pointers, the declared catalogue, the draft delta convention | `seampact-ir`, `seampact-authoring`, `seampact-diagnostics`, `seampact-json`, `seampact-js`, `serde`, `indexmap` |
| `seampact-compiler` | `crates/compiler` | the orchestrator (load, validate, relay order, halves, link, finalize, stop rule), the half dispatch, the `OracleSubject` implementation | `seampact-load`, `seampact-pipeline`, the stage crates as they land, `seampact-oracle` |

- Direction: `load` and `pipeline` never depend on each other; the pass, validate, link and finalize crates depend on `pipeline` (and `authoring`), never on `load`; `compiler` sits above all of them. A pass crate cannot reach the orchestrator, which is what `pipeline/seam.ts` enforces by a test in the TypeScript.
- The derivation table is a module of `seampact-pipeline`, not its own crate: its owner columns name halves, and ownership reads its owner column, so either split would make a cycle.
- `seampact-span` keeps what it has: `normalize_text`, `SourceFiles`, `SourceFiles::location` (the port of `siteOf`). The loader calls them and ports neither. The char-to-byte conversion of `saphyr-parser` positions is YAML-specific and stays in `seampact-load`.
- `watch.ts` is left out of this layer: it is a CLI primitive over the file list the loader returns (`LoadOutput::read_files`); the CLI lane ports it. `golden.ts` and `cpu-bound.ts` are TypeScript test helpers: `golden.ts` becomes a test helper of `seampact-load` (it reads `fixtures/` and `expected.txt`), `cpu-bound.ts` is not ported (the limits are tested by counts, not by time).
- No library crate here has an environment error: the reader answers `None` where the TypeScript answered `undefined`, as `reader.ts` does. Every function whose failure is a bug returns `Result<_, InternalError>`.

## 2. The loader: inputs, outputs, flow

```rust
pub trait LoadReader {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText>;   // None: missing or not a file
    fn list_dir(&self, dir: &str) -> Option<Vec<String>>;
    fn real_path(&self, file: &str) -> Option<String>;                      // root-relative, or absolute when unreachable
    fn ascent(&self) -> u32;
}
pub enum LoadText { Text(String), TooLarge }

pub struct LoadOptions<'run> { pub reader: &'run dyn LoadReader, pub entry: &'run str }
pub struct LoadOutput {
    pub workspace: RawWorkspace,     // crates/authoring, as given
    pub files: SourceFiles,          // every file read, normalised; owns the text the spans point into
    pub diagnostics: Vec<Diagnostic>,// sorted with diagnostic_sort over the workspace table
    pub read_files: Vec<String>,     // every file read or tried, sorted by cmp_utf16 (LoadResult.files)
    pub fragments: Vec<LoadFragment>,
}
pub fn load_workspace(options: &LoadOptions<'_>) -> Result<LoadOutput, InternalError>;
```

- Paths inside the loader are root-relative `String`s with `/`, as in the TypeScript; `camino` appears only in `FsReader` (the port of `loadFsReader`). `MemoryReader` ports `loadMemoryReader` for tests.
- Reading: `FsReader::read_text` reads at most `LOAD_MAX_FILE_BYTES`, strips one leading UTF-8 BOM and decodes with `String::from_utf8_lossy`, which is what `new TextDecoder("utf-8")` does (BOM stripped, U+FFFD per invalid sequence). `SourceFiles::add` then strips a second BOM and normalises line ends, as `normalizeText` did on the decoded text.
- A site in a file the loader did not read (the entry outside the root, a file that is missing or too large) is offset 0 of an empty `SourceFiles` entry added for that path, so it prints `1:1`, as the TypeScript `entrySite` does.
- The reporter (`report.ts`) owns the loader's `DiagnosticSink`, the `seen` set, `relabel` and the workspace `Locations` table. A load diagnostic is located by its site pointer `/~load/<file>/<line>/<column>`, so the reporter turns the site's span into a `Location` when it reports (`SourceFiles::location`); a `None` there is an `InternalError`. The rule ids keep `seampact/load/`; the rule enum and the message functions live in `seampact_load::report` (spans note, section 5).
- Limits port as `pub const` with the TypeScript values (`LOAD_MAX_FILE_BYTES`, `LOAD_MAX_DEPTH`, `LOAD_MAX_WORK`, `LOAD_MAX_TEXT`). The budget counts text in UTF-16 units (`value.length`), keys included, once per use, as `budget.ts` documents; work units as `loadWorkOf`.
- Flow, as `loader.ts`: entry check, entry layer (`workspace` or `api`), workspace mode or single-api mode, per api its layers (`api`, `shared`, `base`, packs in apply order), `merge_layers`, then the `RawApi`. Diagnostics are reported in emit order and sorted once at the end.
- The authored-key defences of `json.ts` (`__proto__`, `constructor`, `prototype` refused before they become keys, `reserved-key`) stay: they are diagnostics with fixtures, not JavaScript plumbing. Every object is a `JsonObject`, whose `insert` keeps JavaScript key order (IR note, section 6).

## 3. YAML: parser, tree and positions

- **Parser.** `saphyr-parser` 0.3.4 (already pinned) in event mode with `keep_tags(true)`, on the normalised text of `SourceFiles`. `seampact_load::yaml` builds a node tree from the events, iteratively (an explicit stack), which `source.ts`, `expand.ts` and `compose.ts` walk as they walked the `yaml` package's nodes:

```rust
pub struct YamlNode { pub span: Span, pub anchor: Option<YamlName>, pub tag: Option<String>, pub kind: YamlKind }
pub enum YamlKind {
    Scalar { value: String, style: ScalarStyle },   // style: plain, quoted, block
    Mapping(Vec<YamlPair>),                          // in source order, duplicates kept
    Sequence(Vec<YamlNode>),
    Alias(YamlName),
}
pub struct YamlPair { pub key: YamlNode, pub value: Option<YamlNode> }
pub struct ParsedFile { pub path: String, pub boundary: String, pub file: FileId, pub root: Option<YamlNode> }
```

- **Positions.** `saphyr-parser` markers count characters, not bytes. The tree converts each marker through a per-file table of byte offsets every 64 characters (a walk of at most 63 characters per lookup), so a span holds byte offsets as the spans note requires.
- **The value range.** A node's span is the `yaml` package's `range[0]..range[1]`: a scalar's value without its anchor or tag (the parser's span starts at `&name` or `!tag`; the tree moves the start past the properties and the white space after them), a mapping or sequence from its first token to the end of its last value, an alias `*name` whole. `pairSite` is the key's start to the value's end. The loader fixtures check every site; `load-source` also tests a table of ranges recorded once from the `yaml` package (anchored, tagged, flow, block, empty value).
- **Names.** The parser gives anchors and aliases as ids only. The tree reads the name from the text under the span (`&name`, `*name`), which `yaml-anchor` prints.
- **Tags.** `keep_tags` gives `handle` and `suffix`; the shown tag is `handle + suffix` with `tag:yaml.org,2002:` written `!!`, as the TypeScript prints it.
- **Plain scalars.** The resolver is ours (PORTING section 9): the `yaml` package's core schema, spelling by spelling (`null`/`Null`/`NULL`/`~`/empty, `true`/`True`/`TRUE`, `false`/`False`/`FALSE`, decimal, `0o` octal, `0x` hex, floats, `.inf`, `.nan` and their cases), each with a table test. A number becomes a `JsonNumber` from its token (an integer above 2^53 keeps its digits: `differences.yaml` `big-integers-*`). P1 to P4 port as the ADR 0002 expressions verbatim with `regress`, built once per load (a build failure is an `InternalError`, and a test builds them). A key's string is `keyString`: the source text for a plain key, else the value's ECMAScript text (`seampact-js` number text for a number).
- **Duplicate keys.** The parser passes them through; the loader reports `duplicate-key` itself, as with `uniqueKeys: false`.
- **Errors.** The parser stops at its first error; the `yaml` package collected several. The loader reports that one as `yaml-syntax`, with `YAML syntax error: <parser info>` and the TypeScript fix, at the error marker, and the file's root is `None`. The parser's text differs from the `yaml` package's: the one fixture that shows a syntax error needs a `message` entry in `differences.yaml` (section 10).
- **Several documents.** A second `DocumentStart` reports `yaml-document` from its `---` to the end of the text (the `yaml` package's `MULTIPLE_DOCS` range); the first document stays the root.
- **Depth.** The tree builder stops below `LOAD_MAX_DEPTH + 1` and reports `too-deep`, as the walk of `source.ts`; block nesting has no parser limit. The parser refuses a 256th nested flow collection with "recursion limit exceeded"; such a file is over `LOAD_MAX_DEPTH` in any case, so the loader reports that error as `too-deep` at its marker, never as `yaml-syntax`.
- **Escapes.** The parser refuses `\uD800`-style surrogate escapes, paired or lone, as a syntax error. A lone surrogate cannot reach a Rust `String`, so a refusal is the only answer; it is reported as `yaml-syntax`. The paired form, which the `yaml` package accepts, is a difference (section 10).
- **`$file` JSON.** `serde_json` into `JsonValue`; a duplicate key keeps its first position and its last value, as `JSON.parse`. The `file-invalid` message ends with the parser error: an unexpected end is written `Unexpected end of JSON input` (V8's text, which a fixture holds); any other error uses `serde_json`'s category text, and a fixture that shows one needs a `message` entry.

## 4. Expand, compose, golden and pack files

- **Expand** (`expand.ts`) keeps its algorithm and its class shape: an `Expander` struct holding `&mut FileStore`, `&mut Reporter` and `&mut LoadBudget` for one load, building one `LayerBuild` per layer file. `$include`, `$file` and the file form of `$ref` expand over the YAML tree, so every merged node keeps its span; `locs` maps a layer pointer to its span (`IndexMap<String, Span>`), keyed by `seampact_span::location_key`.
- **`LayerBuild`** is defined by the `load-source` lane with the fields of `expand.ts` (the parsed file, the layer, the built tree, `locs`, the refs and their uses, the schema elements), so `load-expand` and `load-compose` port against one type in parallel.
- **Positions** (`positions.ts`) is the bounded interpreter of the embedded authoring schemas (`seampact_authoring::AUTHORING_SCHEMA_FILES`): `POSITION_KEYWORDS` modelled, `IGNORED_KEYWORDS` ignored by name, and the test that fails on any other keyword the schemas start to use.
- **Compose** (`compose.ts`) ports `merge_layers(layers, reporter, budget) -> Merged`: the merged `JsonObject`, `leaf_origins` and the api's `Locations`, every node copied and charged as the TypeScript charges it.
- **Pack files** (`pack-files.ts`, the pack walk of `loader.ts`): the `node_modules` walk is bounded by `LoadReader::ascent`; the package-name grammar and its length bound port as code; the vendored `.packs` directory names port as given.
- **Golden files.** The `golden.ts` helper becomes `seampact_load` test support: it loads a fixture directory with `FsReader`, prints the diagnostics with `print_diagnostics` and compares with `expected.txt`. The oracle remains the acceptance test; the golden helper serves the lane's own tests.

## 5. The pipeline: draft, halves and ownership

- **Half names.** `enum Half { TreeSchemas, TreeNodes, AccessIdentity, AccessRights, DeriveWire, DeriveErrors }` with `Half::RUN_ORDER`, `pass()`, and `as_str()` giving `tree.schemas` and the others; `PassName` likewise.
- **The draft.** `DraftIr` mirrors the TypeScript `DraftIR` (`draft.ts`): the IR's members optional at each level where several halves write (the root, `api`, an operation, its `input`, `params`, `concurrency`, `paging` and `paging.sortKeys[]`), the IR types of `seampact-ir` below. Operations are a `Vec<DraftOperation>` that only `tree.nodes` fills. `DraftIr` derives `Serialize` and `Deserialize` to the TypeScript draft JSON; a test decodes every cumulative draft of every fixture's halves and writes it back to the same value, which replaces the derived draft schema of `draft-schema.ts`.
- **A half** is a function of its crate:

```rust
pub fn derive_wire(draft: &DraftIr, context: &mut HalfContext<'_>) -> Result<DeriveWireOutput, InternalError>;
```

  It reads the merged draft by shared reference and returns an owned output holding only the fields ADR 0006 section 3 gives it. `tree.schemas` returns `TreeSchemasOutput`, which also carries the schema service.
- **Outputs and merge.** `seampact_pipeline::outputs` holds the six output types and, for each, `merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError>`, which moves the values into the draft. The ownership table of `ownership.ts` becomes these types and these six functions: an `owned` field is set where `None`; an `elements` list is extended, so lists concatenate in run order; a `default` field is set where `None`. Any write over a value already set is an `InternalError` naming the field and the operation. A later half's per-operation output is a `Vec` with one entry per draft operation, in draft order; another length is an `InternalError`.
- **Derived elements.** The element-owner rule of `ownership.ts` (an element with `derivedFrom` belongs to the half that owns its derivation in the derivation table) runs in `merge_into` for every element of an `elements` list: a derived element of another half's derivation is an `InternalError`. The `derivations` lane adds this check with the table.
- **Why this replaces the guard.** `guard.ts`, `view.ts` and `readonly.ts` freeze and proxy at run time so a half cannot write outside its fields or change what it reads. In Rust a half holds `&DraftIr`, `&RawApi`, `&RawWorkspace` and `&ContractIr`, and writes only through its output type, so both are compile errors; `pipelineCopy` disappears (a value moves into the output or is cloned from a borrow, never aliased). The read declarations (`reads`) are not checked per access: each half keeps them as a `const READS: &[DraftField]`, and a pipeline test checks that every field a half reads is written only by halves that run before it (the property ADR 0006 section 2 needs from the order). The guard, view, readonly, registry, seam and index files are traced as skips with that reason.
- **The schema service.** `trait TreeSchemaService` in `seampact-pipeline` (`type_use`, `query_wire`, `check_example`, `check_text_example`, the four methods of `pass.ts`, each answering an owned value), implemented in the `tree.schemas` crate. Later halves receive `&dyn TreeSchemaService` through their context. It holds no reference to the draft.
- **Not threads.** A pipeline runs the apis of a workspace one after another in relay order, as the TypeScript does; `DraftIr` and every output are `Send + Sync` (asserted), so a later layer may run independent apis with `rayon` and fix the order afterwards.

### First-Some-wins against the `default` mode

The IR note (section 5) asked whether "the first `Some` in run order wins" matches ADR 0006's `default` mode. It does, in a stricter form:

- Every later writer of a `default` field reads the merged draft and writes only where the value is absent: `derive.wire` maturity (`lifecycle.ts`, `if (operation.maturity !== undefined) return`), `derive.wire` and `access.identity` `unknownKeys` (`unknown-keys.ts`, `signed.ts`, both return when the use sets one), `access.identity` `rawBody` (on a declared input, which `tree.nodes` writes without `rawBody`), `access.rights` `input` (a proof-only input only where the route declares none).
- `draftFixtureDelta` throws on any replaced member, and it ran on every half of every fixture to write `fixtures/expected/**/halves/`, so no fixture has a half that replaces a value.
- So at most one half produces `Some` for a `default` field. Since each half reads the merged `DraftIr`, a later half sees an earlier half's value and produces `None`; `merge_into` refuses a second `Some` with an `InternalError` rather than keeping the first one silently. "First `Some` wins" never has to choose.

## 6. Inherited and declared values, conventions

- **Context.** `HalfContext<'run>` ports `PassContext`: `raw: &RawApi`, `workspace: &RawWorkspace`, `conventions: &ResolvedConventions`, `inherited: &Inherited<'run>`, `relayed: &dyn RelayedDrafts` (`relayed(api) -> Option<&DraftIr>`), `imported(api) -> Option<&ContractIr>` from the `imports` option, `origin(pointer) -> Option<Origin>`, `sink: &mut DiagnosticSink`. Halves after `tree.schemas` also get `schemas: &dyn TreeSchemaService`; Rust passes it as a separate argument of those five halves, as `PassContextOf` does by type.
- **Inherited** (`inherited.ts`): one reader built per api from the tree-node model (`tree.ts`). The four merge shapes (`NearestSetting`, `PerKeySetting`, `OrderedSetting`, `UnionSetting`) become one enum of setting names and one method per shape (`nearest`, `per_key`, `ordered`, `union`), each answering entries with the origin of the node that set them; asking a shape of a setting that has another shape is impossible because each method takes its own setting enum. It reports nothing, as the TypeScript.
- **Conventions** (`conventions.ts`): `ResolvedConventions` with each reading's value and origin, or the core default with no origin; the default table and the schema leaves test port with it. It reads `derivations/roles.ts`, so it lands after the derivations lane.
- **Declared** (`declared.ts`): `pipeline_declared(raw, ir) -> Vec<PipelineDeclared>`, read by lint after finalize.
- **Units and pointers** port as functions (`parse_size`, `parse_duration` over the grammar's own patterns; `json_at_pointer`, `pointer_below`, `pipeline_origin`).

## 7. The orchestrator and the seam with finalize

- `compile_workspace(options) -> Result<PipelineResult, InternalError>` in `seampact-compiler` keeps the order and the stop rule of `orchestrator.ts`: load stops on an error, validate on any diagnostic; per api in relay order, the six halves, each a step of the stop rule; an api that relays to a stopped api is skipped with no diagnostic; link and finalize run only when no api has an error.
- **Drafts across apis.** The orchestrator keeps finished drafts in an `IndexMap<String, DraftIr>` and runs the next api with that map borrowed (`relayed`) while its own draft is a separate owned value; link receives `&` to every draft.
- **Half dispatch.** `run_half(half, draft, context) -> Result<HalfRun, InternalError>`, a `match` on `Half` calling each half's crate and merging its output. Until a half is ported its arm returns `HalfRun::NotPorted`; each pass lane replaces its arm, and the arm and the variant go away with the last half. The TypeScript's injected `parts` (fakes for the orchestrator tests) are not ported: the Rust orchestrator is tested on fixtures.
- **Finalize** takes the draft by value: `finalize(draft: DraftIr, context: &mut FinalizeContext<'_>) -> Result<Option<Finalized>, InternalError>`, with `Finalized { ir: ContractIr, source_map: SourceMap }`. It moves the parts into the IR without copying, so the aliasing caution of `stages.ts` has no Rust counterpart. Its `report` is closed by the borrow: the context lives only for the call.
- **Results.** `PipelineResult` keeps `files`, the workspace diagnostics and table, and one `PipelineApiResult` per api in workspace order (sorted diagnostics, its `Locations`, the IR, the source map and the declared list when finalize produced them), plus the `SourceFiles` the tables point into.

## 8. The compiler entry seen from the oracle

`seampact-compiler` implements `seampact_oracle::OracleSubject`, the harness trait of the oracle lane:

- **`compile(fixture)`** runs `compile_workspace` with an `FsReader` rooted at the fixture and answers the `diagnostics.json` value (`diagnostics_json`), and per api the IR and source-map bytes from the canonical writer. It answers `NotPorted` as soon as the run reaches a stage that is not ported (validate, a half, link, finalize), so the loader is compared on every fixture whose load stops, from the `load-entry` lane on.
- **`run_half(fixture, api, half, ...)`** runs one half alone from the expected deltas before it:
  1. load the fixture (the half needs `raw`, its conventions and inherited reader); a fixture whose load reports an error answers `NotPorted` for its halves, which the harness never asks;
  2. apply the expected deltas `01` to `NN-1` of that api to an empty draft JSON with `draft_apply` (the port of `draftFixtureApply`, in `seampact_pipeline::delta`), then decode it into `DraftIr`;
  3. for the relayed drafts, apply all six expected deltas of each api before it in relay order;
  4. for every half after `tree.schemas`, build the schema service by running the Rust `tree.schemas` on the raw tree; when `tree.schemas` is not ported, answer `NotPorted`;
  5. run the half, merge its output into a clone of the input draft, and answer `draft_delta(input, output)` (the port of `draftFixtureDelta`) as a `JsonValue`, which the harness compares by value with `NN-<half>.json`.
- The delta is computed from two whole drafts, not from the output types, so the output types need no serialisation of their own, and the dump convention (lists appended or keyed by index, operations by id) lives in one port.

## 9. Wave plan

One lane per 500 to 1,000 TypeScript lines (non-test lines below), at most three at once. Each lane follows the `seampact-rust-port-ts` brief; "Tests" lists the TypeScript test files whose behaviours it ports.

| # | Lane | TS files | Lines | Crate | Model | Wave, after | Tests | Oracle subset |
|---|---|---|---|---|---|---|---|---|
| 1 | `load-base` | `load/reader.ts`, `paths.ts`, `pack-files.ts`, `limits.ts`, `budget.ts`, `json.ts`, `report.ts`, `fragments.ts` | 685 | load | Sonnet high | 1 | `paths.test.ts`, `budget.test.ts`, `fragments.test.ts` | none (unit) |
| 2 | `load-positions` | `load/positions.ts` | 847 | load | Sonnet high | 1 | `positions.test.ts` | none (unit) |
| 3 | `pipeline-seam` | `pipeline/halves.ts`, `draft.ts`, `pass.ts`, `ownership.ts`, `draft-fixture.ts`; skips `guard.ts`, `view.ts`, `readonly.ts`, `registry.ts`, `seam.ts`, `index.ts` | 988 | pipeline | Sonnet medium | 1 | `draft.test.ts`, `pass.test.ts`, `ownership.test.ts`, `draft-fixture.test.ts` | every `fixtures/expected/**/halves/` file through the draft round trip and `draft_apply`/`draft_delta` (a crate test) |
| 4 | `load-source` | `load/source.ts`, `scalars.ts`, plus the YAML tree and the resolver | 511 | load | Sonnet high | 2, after 1 | `pitfalls.test.ts`, `parse-layer.test.ts`, `property.test.ts` (`proptest`), the parse cases of `hardening.test.ts` | none (unit) |
| 5 | `derivations` | `derivations/table.ts`, `roles.ts`, `freeze.ts`, `index.ts`, the element-owner rule of `ownership.ts` | 552 | pipeline | Sonnet medium | 2, after 3 | `derivations.test.ts`, the element rows of `ownership.test.ts` | none (unit) |
| 6 | `load-expand` | `load/expand.ts` | 1,071 | load | Sonnet high | 3, after 2 and 4 | `scalar-type.test.ts`, `included-paths.test.ts`, the expansion cases of `hardening.test.ts` | none (unit) |
| 7 | `load-compose` | `load/compose.ts` | 342 | load | Sonnet high | 3, after 4 | `compose.test.ts` | none (unit) |
| 8 | `pipeline-readers` | `pipeline/conventions.ts`, `inherited.ts`, `tree.ts`, `units.ts`, `declared.ts`, `pointer.ts` | 982 | pipeline | Sonnet medium | 3, after 5 | `conventions.test.ts`, `inherited.test.ts`, `declared.test.ts`, `pointer.test.ts` | none (unit) |
| 9 | `load-entry` | `load/loader.ts`, `index.ts`, `golden.ts` (test support); creates `seampact-compiler` with `OracleSubject::compile` | 938 | load, compiler | Sonnet high | 4, after 6 and 7 | `fixtures.test.ts`, `imports.test.ts`, the loader cases of `hardening.test.ts` | `loader/**`, `rules/load-*`, `limits/depth-*`, then every fixture (load-stopped ones compared) |
| 10 | `pipeline-orchestrator` | `pipeline/orchestrator.ts`, `stages.ts`, `context.ts`; skip `draft-schema.ts` (the typed decode of lane 3 replaces it); `OracleSubject::run_half` | 562 | compiler | Sonnet medium | 4, after 8; rebases on 9 before its oracle step | `orchestrator.test.ts`, `draft-schema.test.ts` (as the typed decode) | `cargo xtask oracle --half tree.schemas` answers not ported until the pass lanes; its own check is the run on `loader/**` |

- Ten lanes, four waves: wave 1 three lanes, wave 2 two, wave 3 three, wave 4 two.
- `load-compose` is below 500 lines on purpose: alone it runs beside `load-expand` against the `LayerBuild` of lane 4, instead of making one 1,413-line lane or delaying the loader entry.
- Not ported: `watch.ts` (CLI lane), `cpu-bound.ts` (test helper), `watch.test.ts`, `guard.test.ts`, `view.test.ts`, `seam.test.ts`, `index.test.ts` (the properties they test are compile errors in Rust); each is a skip line in its lane's `trace.tsv`.
- The loader is compared by the oracle only from lane 9 on: until then each loader lane gates on its ported tests. Lane 9 runs the oracle loop for the whole loader and fixes what it finds in the crate.
- The pass lanes of the next layer start after lane 10; each replaces its arm of the half dispatch and runs `cargo xtask oracle --half <half>`.

## 10. Out of scope and differences to record

- **Validate, the passes, link, the relay order, finalize**: later layers, each through the seams of sections 5 to 7.
- **Watch mode**: the CLI lane, over `read_files`.
- **Differences the lead records in `differences.yaml`** when the oracle shows them (no lane edits the file):
  - the `yaml-syntax` message of the one fixture that holds a syntax error (the parser's text replaces the `yaml` package's);
  - a tab after `:` (`a:\t1`): the parser refuses it as a syntax error, the `yaml` package accepts it; no fixture has one;
  - a paired surrogate escape (`"\ud83d\ude00"`): refused as a syntax error, accepted by the `yaml` package; no fixture has one;
  - several syntax errors in one file: one diagnostic, where the TypeScript reported each.

## Spike evidence

Two throwaway cargo projects (`saphyr-parser` 0.3.4, the pinned version; Node with the repository's `yaml` package for the comparison), deleted after the note:

| Check | Result |
|---|---|
| Marker units on `a: "😀x"` | character offsets (`3..7`), not bytes (`3..10`); line 1-based, column 0-based characters |
| BOM and CRLF on the raw text | the BOM counts as a character; CR is kept in offsets. Parsing the normalised `SourceFiles` text avoids both |
| Duplicate keys `a: 1\na: 2` | both pairs come through as events |
| `a: &anc 1` | parser span `3..9` (from `&`), `yaml` range `8..9` (value only); the anchor name is not in the event |
| `c: !!str 3` | tag `tag:yaml.org,2002:` + `str`; parser span from the tag, `yaml` range on the value |
| `b: *anc` | alias span `13..17`, the same as the `yaml` range |
| `a:\n  - {b: 1\n` | parser: first error only, "while parsing a flow mapping, did not find expected ',' or '}'" at 13; `yaml`: `BAD_INDENT` at 13 "Flow map in block collection must be sufficiently indented and end with a }" |
| Two broken scalars | `yaml` reports two errors; the parser stops at the first |
| `a: 1\n---\nb: 2\n` | `DocumentStart(true)` at `5..8`; `yaml`: `MULTIPLE_DOCS` at `[5, 14]`, first document kept |
| `a:\t1` | parser error "':' must be followed by a valid YAML whitespace"; `yaml` accepts |
| `"\ud800x"`, `"\ud83d\ude00"` | parser error "found invalid Unicode character escape code" for both |
| Flow nesting | error "recursion limit exceeded" at 256 nested `[` (`flow_level: u8`); `limits/depth-nesting-at` and `-over` (255 nested flow maps) parse |
| Block nesting `- - - … x`, 100,000 levels | no stack overflow, 0.05 s, 20 MB |
| Half shape: `DraftIr` read by `&`, owned outputs, `merge_into`, a relayed-draft map borrowed during a run, `Send + Sync` assertions | compiles, clippy clean; a second `Some` on a `default` field fails the merge |
