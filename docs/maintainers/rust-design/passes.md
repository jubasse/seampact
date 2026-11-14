# Rust design: the pass halves

The second port layer of 2.0.0: the six pass halves of [ADR 0006](../../adr/0006-compiler-pass-pipeline.md) (`packages/core/compiler/src/passes/`), link, and the two stages every compile reaches before them: validate (`validate/`) and the relay order (`workspace/order.ts`). It builds on the [loader and pipeline](loader-and-pipeline.md) note (sections 5, 8 and 9 above all) and applies [PORTING.md](../../../PORTING.md). A lane uses these shapes as given; a gap goes to the lead. Evidence for the choices that depend on Rust behaviour is in "Spike evidence".

## 1. Crates

| Crate | Directory | Holds | Depends on (beyond `pipeline`, `ir`, `json`, `js`, `diagnostics`, `authoring`) |
|---|---|---|---|
| `seampact-naming` | `crates/naming` | `packages/core/spec/src/naming` | none |
| `seampact-templates` | `crates/templates` | `templates/reader.ts` | none |
| `seampact-pass-tree-shared` | `crates/pass-tree-shared` | `tree/nodes/names.ts`, `tree/nodes/raw.ts`, `treeNodesRelayOrigin` and `TREE_NODES_OPERATION_KIND` of `tree/nodes/relays.ts` | `naming` |
| `seampact-pass-tree-schemas` | `crates/pass-tree-schemas` | `passes/tree/schemas`, the `TreeSchemaService` implementation | `naming`, `pass-tree-shared` |
| `seampact-pass-tree-nodes` | `crates/pass-tree-nodes` | `passes/tree/nodes` but the shared files, `limits.ts` included | `naming`, `templates`, `pass-tree-shared` |
| `seampact-pass-access-identity` | `crates/pass-access-identity` | `passes/access/identity` | none (it reaches `tree.schemas` through the service only) |
| `seampact-pass-access-rights` | `crates/pass-access-rights` | `passes/access/rights` | `naming`, `pass-tree-nodes` |
| `seampact-pass-derive-wire` | `crates/pass-derive-wire` | `passes/derive/wire` | `pass-tree-shared`, `pass-tree-schemas` (the two pattern helpers), `pass-tree-nodes` |
| `seampact-pass-derive-errors` | `crates/pass-derive-errors` | `passes/derive/errors` | `naming`, `templates`, `pass-tree-shared`, `pass-tree-nodes` |
| `seampact-pass-link` | `crates/pass-link` | `passes/link` | none |
| `seampact-validate` | `crates/validate` | `validate/`, and the `JsonValue` to `serde_json::Value` conversion `jsonschema` reads (module `json_value.rs`; it moves to a crate of its own when a second stage needs it) | `jsonschema`, `serde_json` |

- Dependency rule: a pass crate depends on the crates of halves that run before it, never on a later half, on `seampact-compiler` or on `seampact-load`. The table lists the edges the coverage tables show (`derive.wire` imports `treeSchemasEscapePatternLiteral` and `treeSchemasNormalizePattern`; `access.rights`, `derive.wire` and `derive.errors` import `tree.nodes`); every other call into `tree.schemas` goes through the service. A new edge to an earlier half is allowed and named in the PR body; an edge to a later half goes to the lead.
- `seampact-pass-tree-shared` holds the only code an earlier half reaches in a later one: `tree.schemas` runs before `tree.nodes` and reaches `names.ts` (284 pairs, `treeNodesOperationNames` and `treeNodesOpOwner` among them) and `raw.ts` (238 pairs). `limits.ts#treeNodesBodyLimit` stays in `pass-tree-nodes`: only later halves reach it.
- `seampact-naming` also fills `derivationParamsSchemaId`, which the pipeline layer left deferred; `seampact-pipeline` gains the dependency.
- The relay order (`workspace/order.ts`) is `crates/compiler/src/relay.rs`: it orders the apis of one compile and no other crate calls it.
- `quote` and `unsafe` (`validate/diagnostics.ts`) and `accessRightsQuoted` are one module, `seampact-diagnostics` `text.rs`, written in the seam PR (section 4). `quote` of a non-string writes `JSON.stringify` key order; the seam adds that writer to `seampact-json` beside `write_json_string` and the canonical writer.
- `finalize/canonical-order.ts#finalizeCompareText`, reached by `derive.errors`, is `cmp_utf16`; it is not ported.
- The `spec/src/ir` helpers the halves reach (sensitive field and `IrSensitiveReach`, closed declaration, instance walk, schema walk, type use, calendar date) are modules of `seampact-ir`, ported by the first brief that reaches them. `docs/maintainers/rust-design/passes/foreign.tsv` lists each foreign file and the pairs that reach it.
- A function ported in another crate is one skip line in the trace of the crate whose TypeScript directory holds it: `-\t<ts file>#<fn>\tskip: ported in <crate> (<rust path>)`.

## 2. NotPortedYet

```rust
// seampact-pipeline, error.rs
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PassError {
    #[error("not ported yet: {function}")]
    NotPortedYet { function: &'static str },   // the TypeScript function name
    #[error(transparent)]
    Internal(#[from] InternalError),
}
```

- `PassError` derives the traits `InternalError` derives and implements `Display` and `Error` through `thiserror` (`seampact-pipeline` gains the workspace dependency); `Internal` displays the `InternalError` text, escaped as it is, and `#[from]` gives the `From<InternalError>` that `?` needs.
- `PassError` lives in `seampact-pipeline` because `TreeSchemaService` methods return it: a later half calling a service method that reaches an unported `tree.schemas` function stops with `NotPortedYet`, not with a wrong answer.
- Each pass crate builds it only through `src/not_ported.rs`: `pub(crate) fn not_ported_yet(function: &'static str) -> PassError`.
- A stub returns `Result<_, PassError>`, and so does a ported function that can fail: it has a throw site, calls a fallible reader, or calls a function that returns `Result` (a stub included). A brief that ports a function that cannot fail drops its `Result` and the `?` at its callers in the same brief; a brief that ports the last fallible callee of a function does the same for that function. `clippy::unnecessary_wraps` (pedantic, denied by the gate) refuses a private function that returns `Result` and never fails.
- A stub is a whole function with the TypeScript signature and a `not_ported_yet("<tsName>")` body. A branch reaching an unported callee needs no stub of its own: the callee's error propagates through `?`. Briefs port whole functions.
- Each crate carries `#![allow(dead_code, reason = "functions reached only by stubs until the half's last brief")]` in `lib.rs` while stubs exist. Not `expect`: it fails `-D warnings` as unfulfilled whenever nothing is dead (the seam crates, a brief whose remaining stubs are leaves).
- The dispatch maps `NotPortedYet` to `HalfRun::NotPorted` and `Internal` to `Err(InternalError)`; the oracle counts a not-ported pair as skipped, never as a match.
- Diagnostics reported before a `NotPortedYet` are dropped for that pair by construction: `run_halves` and `run_fixture_half` give each half a fresh sink and merge its output and diagnostics only on `Ok`.
- End of a half: its last brief deletes `not_ported.rs` and the `allow`; `rg 'NotPortedYet|not_ported_yet|allow\(dead_code' crates/pass-<half>/src` prints nothing and `cargo xtask oracle --half <half>` reports 0 not ported (for `tree.schemas`, also 0 not-ported service calls, section 5).
- End of the layer: one scripted change removes the `NotPortedYet` variant and `HalfRun::NotPorted`, and turns `PassError` into `InternalError` in every signature.

## 3. Scope, owned output and cross-half helpers

The TypeScript `scope` objects mutate the draft; the Rust halves never do (loader and pipeline note, section 5). A half reads the draft and writes its owned output through one scope struct:

```rust
pub(crate) struct DeriveWireScope<'draft, 'half, 'run> {
    draft: &'draft DraftIr,
    context: &'half mut HalfContext<'run>,
    schemas: &'half dyn TreeSchemaService,     // owned apart from the draft, borrowed for the half's run
    output: DeriveWireOutput,                    // the accumulator
    reported_collisions: HashSet<String>,        // lookup only
    setting_faults: IndexMap<String, SettingFault>, // iterated: insertion order kept
}

impl DeriveWireScope<'_, '_, '_> {
    fn query_params_of(&self, operation: OperationIndex) -> impl Iterator<Item = &Param>;  // draft list chained with the additions
    fn add_query_param(&mut self, operation: OperationIndex, param: Param);
    fn into_output(self) -> DeriveWireOutput;
}
```

- Three lifetimes: `HalfContext<'run>` is invariant behind `&mut`, so one shared lifetime does not compile (spike).
- The accumulator is the half's owned output, built up front with one entry per draft operation (`operations[i]` matches `draft.operations[i]`); a half-level member (`api_wire`) starts from its default.
- `OperationIndex(usize)`: a newtype in `seampact-pipeline` `outputs/` for the position of an operation in `draft.operations`, built only by the walk over the draft operations (`DraftIr::operation_indices()`), so an index into another list cannot reach a merged view.
- The TypeScript halves read the draft they mutate: the collision checks read the declared elements plus those already derived, and a function may read a member another function of the half wrote earlier. Rust reads a merged view for every member the half writes and reads back: one `<member>_of(..)` method per member, the draft value chained with (a list) or replaced by (a scalar) the accumulator's. Writes go only through `add_<member>` or `set_<member>`, so the view and the output cannot drift.
- A loop over draft elements that also writes copies the reference first (`let draft = scope.draft;`), so the loop borrows the draft, not the scope.
- A TypeScript `Set` used only for lookups is a `HashSet`; a `Map` or `Set` that is iterated is an `IndexMap` or `IndexSet`.
- The half's entry builds the scope, runs the TypeScript body and answers `scope.into_output()`; the dispatch merges it with `merge_into`.
- `IrSensitiveReach`: `seampact-ir`, `sensitive` module (section 1), never a local copy in `pass-derive-errors`.
- `quote`: `seampact-diagnostics` `text.rs` (section 1), from the seam PR on.
- `treeNodesBodyLimit`: `pass-tree-nodes`, public; the coverage script orders functions that other halves call right after the spine, so it lands in brief 3 of `tree.nodes`, the first after the spine.

## 4. The seam PR

One PR, before any pass lane, small enough to land first. It starts once the oracle-dump lane has landed the expected files below.

### Expected files

The oracle-dump lane writes both under `fixtures/expected/<fixture path>/` and documents them in [scripts/oracle/README.md](../../../scripts/oracle/README.md), which wins over this paragraph where they differ:

- `halves/<api>/<NN>-<half>.diagnostics.json`: the diagnostics one half reported, `NN` as in the delta file `<NN>-<half>.json` beside it. A JSON array of diagnostics in the shape of one entry of `diagnostics.json`, sorted (the key is the one the README names); written only when non-empty, so an absent file is `[]`.
- `schema-calls/<api>.json`: every `TreeSchemaService` call the api's later halves made, `[{ "method", "args", "answer"? }]`. `method` is the TypeScript method name (`typeUse`, `queryWire`, `checkExample`, `checkTextExample`); `args` the positional arguments; calls are deduped by `(method, args)`; `answer` is omitted when the TypeScript answered `undefined`. An absent file means the api's later halves made no call.

Per method, the argument encoding and the answer decoding of the replay:

| Method | `args` | `answer` | Absent `answer` |
|---|---|---|---|
| `type_use(pointer, direction)` | `[pointer, direction]`, the direction as its IR string | `TypeUse` through its IR serde form | `None` |
| `query_wire(pointer)` | `[pointer]` | `QueryWire` through its serde form | `None` |
| `check_example(value, schema_use)` | `[value, schema_use]`, the value as is, `TypeUse` in its IR serde form | an array of `TreeSchemaExampleIssue` | `PassError::Internal`: the TypeScript answers a list, never `undefined` |
| `check_text_example(text, schema_use)` | `[text, schema_use]` | as `check_example` | as `check_example` |

A type the seam reads that has no serde form gets a reader in `seampact_compiler::oracle`, not a derive on the shared type.

### Contents

- `PassError` (section 2); `TreeSchemaService` methods return `Result<_, PassError>`; `OperationIndex` and `DraftIr::operation_indices()` (section 3).
- `LaterHalf` in `seampact-pipeline` `halves.rs`: the five halves after `tree.schemas`, so the service argument cannot be missing where it is needed. `impl From<LaterHalf> for Half`; `LaterHalf::RUN_ORDER: [LaterHalf; 5]` in `Half::RUN_ORDER` order; `Half::TreeSchemas` has no `LaterHalf`.
- Entry function of each pass crate, in `lib.rs`:

  ```rust
  // seampact-pass-tree-schemas
  pub fn run(draft: &DraftIr, context: &mut HalfContext<'_>)
      -> Result<TreeSchemasOutput, PassError>; // holds the service (`into_parts`)
  // the five later halves, <Half>Output from seampact-pipeline outputs/
  pub fn run(draft: &DraftIr, context: &mut HalfContext<'_>, schemas: &dyn TreeSchemaService)
      -> Result<<Half>Output, PassError>;
  // seampact-pass-link
  pub fn run(drafts: &IndexMap<String, DraftIr>, workspace: &RawWorkspace,
      imports: &IndexMap<String, ContractIr>) -> Result<Vec<(String, Diagnostic)>, PassError>;
  ```

  The service owns what it reads (`Box<dyn TreeSchemaService>` is `'static`): it copies from the draft and the context, never borrows them.
- Dispatch in `crates/compiler/src/half_run.rs`:

  ```rust
  pub enum TreeSchemasRun { Merged(Box<dyn TreeSchemaService>), NotPorted }
  pub fn run_tree_schemas(draft: &mut DraftIr, context: &mut HalfContext<'_>)
      -> Result<TreeSchemasRun, InternalError>;
  pub fn run_half(half: LaterHalf, draft: &mut DraftIr, context: &mut HalfContext<'_>,
      schemas: &dyn TreeSchemaService) -> Result<HalfRun, InternalError>;
  ```

  Each arm calls its crate's entry function, maps `PassError` (section 2) and merges the output with `merge_into` on `Ok`.
- `run_halves` (`orchestrator.rs`): `run_tree_schemas` with a fresh sink, then `LaterHalf::RUN_ORDER` through `run_half` with a fresh sink each and the service as `&*service`. The stop rule is today's, applied after each of the six: `NotPorted` ends with `HalvesEnd::NotPorted(half)`, an error diagnostic ends the api.
- Link: `link_workspace` (`stages.rs`) calls `seampact_pass_link::run` and answers `Result<StageAnswer<_>, InternalError>`: `NotPortedYet` is `StageAnswer::NotPorted`, so the run stops at `Stage::Link` as today; `Internal` is the `Err`.
- Six pass crates and `seampact-pass-link`, each with its entry function as a stub, `src/not_ported.rs`, the `allow`, an empty `trace.tsv` and `pub const RULE_IDS: &[RuleId] = &[];`, which brief 1 of the half fills. `rule_id_registry()` of `seampact_compiler::oracle` reads every crate's `RULE_IDS`.
- `text.rs` with `quote`, `unsafe`, `accessRightsQuoted` and the `JSON.stringify`-order writer (section 1), with their unit tests.
- Oracle `run_half` answers `HalfOutput { delta, diagnostics }`; the harness compares `diagnostics` with `<NN>-<half>.diagnostics.json` (an absent file is `[]`).
- `seampact-oracle` `expected.rs` reads `schema-calls/<api>.json` into `Vec<RecordedCall { method, args, answer: Option<JsonValue> }>` and hands it to `run_half`.
- `RecordedSchemaService` in `seampact_compiler::oracle`: answers a call by looking up the canonical JSON of `[method, args]` among the recorded calls and decodes the answer as the table says; a miss is `PassError::Internal` naming the method and its arguments. `run_fixture_half` runs every half after `tree.schemas` against it, which lifts today's gate that answers `NotPorted` for them.
- The fourth `OracleSubject` method, `replay_schema_calls` (section 5), with the stub answer `NotPorted` until `tree.schemas` has a port.
- `differences.schema.json` gains two `output` values: `half-diagnostics` (the file `<NN>-<half>.diagnostics.json`, addressed by `api`, `half` and a pointer into the array) and `schema-calls` (addressed by `api` and the pointer `/<index>/answer`, `index` the position of the call in `schema-calls/<api>.json`).
- The `oracle_run.rs` test stops pinning the list of stale entries: it asserts only that every problem line is a stale-difference line.

## 5. The service replay check

The halves after `tree.schemas` are compared against the recorded service; the Rust service is checked against the same records:

- The fourth `OracleSubject` method, added by the seam PR:

  ```rust
  fn replay_schema_calls(&self, fixture: &Fixture, api: &str, input: &HalfInput<'_>,
      calls: &[RecordedCall]) -> SubjectAnswer<Vec<Option<JsonValue>>>;
  ```

  It builds the Rust service with `run_tree_schemas` on an empty draft and a context that relays `input.other_apis` (the expected deltas of the other apis: `tree.schemas` reads the relayed and imported drafts), then answers every recorded call in order, encoded back as the `answer` column of the table in section 4 (`None` where the TypeScript omitted it).
- The harness compares each answer with the recorded `answer` by value; a mismatch is addressed as section 4 says (`output: schema-calls`). It runs within `cargo xtask oracle` whenever the selection includes `tree.schemas` (no `--half`, or `--half tree.schemas`), with the verdict line `service calls: <matched> of <n>, <not ported> not ported`.
- An oracle mode, not a separate xtask step: it reuses the fixture walk, the `differences.yaml` matching and the gate's oracle step. The end of `tree.schemas` requires 0 not-ported service calls.

## 6. Coverage tables

- `scripts/rust/pass-coverage.ts` writes one TSV per crate in `docs/maintainers/rust-design/passes/` (`pass-<half>.tsv`, `pass-tree-shared.tsv`, `pass-link.tsv`, `validate.tsv`, `compiler-relay-order.tsv`, `templates.tsv`) plus `foreign.tsv`. Columns: `brief`, `function`, `file`, `lines`, `size`, `pairs` (pairs reaching the function over the pairs of the half). Function names are those of `trace.tsv` (`listTypeScriptFunctionRanges` of `scripts/rust/trace.ts`).
- Rerun after a fixture change: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/pass-coverage.ts`. The brief numbers and counts below include the converted test fixtures.
- A pair is one run of the half on one (fixture, api). For `tree.schemas`, a pair also reaches the `passes/tree/schemas/` functions the api's later halves run through the service: the service replay (section 5) compares them under that pair.
- A function no fixture reaches has `pairs` 0 and sits in the last brief; its behaviour comes from the converted fixtures or a hand-ported test (section 9).

## 7. Briefs

Cut rule, applied by the script per crate:

1. Brief 1: the skeleton (the types, every function's signature with a `NotPortedYet` body, the entry function and `RULE_IDS`), plus the spine (the functions reached by 90% of the pairs) when skeleton and spine together stay under the PR size rule (A47): about 4,000 Rust lines, estimated at 15 Rust lines per stubbed signature (the derive.wire skeleton spike, 1,558 lines for 101) and 2 Rust lines per TypeScript line (layer 1). Otherwise brief 1 is the skeleton alone and the spine opens brief 2.
2. Then the functions other halves' crates import: by name for `tree.schemas` (`treeSchemasEscapePatternLiteral` and `treeSchemasNormalizePattern`, which `derive.wire` imports; service reach is no import), by the run windows of the other halves for `tree.nodes`.
3. Then, greedily, the reached function with the highest score per TypeScript line, where each pair it reaches adds `1 / m²`, `m` the number of that pair's functions still unported, this one included: pairs nearest to complete weigh most.
4. Then the rarely reached, the never reached last.
5. A brief closes past about 1,000 function lines, brief 1 sooner when the skeleton leaves less room; the spine and a function are never split.

A brief names its functions with TypeScript line ranges (`rg '^<n>\t' docs/maintainers/rust-design/passes/<crate>.tsv`), the oracle command (`cargo xtask oracle --half <half>`, or `cargo xtask oracle` for the stages) and the TypeScript test files of the directory; for these it says "ledger from the converted fixtures": the converted fixtures carry their cases, and the lane hand-ports only what section 9 lists.

Measured (function lines per brief, 0 for a skeleton-only brief 1; skeleton in estimated Rust lines; pairs comparable after each brief, foreign dependencies ignored):

| Crate | Lines | Skeleton | Briefs | Lines per brief | Comparable pairs after each brief | Share after each brief |
|---|---|---|---|---|---|---|
| `pass-tree-schemas` | 4,721 | 4,080 | 6 | 0 996 991 996 988 750 | 0 25 129 499 778 896 of 896 | 0 3 14 56 87 100% |
| `pass-tree-nodes` | 4,725 | 4,245 | 6 | 0 996 990 993 990 756 | 0 73 92 386 656 730 of 730 | 0 10 13 53 90 100% |
| `pass-access-identity` | 1,956 | 1,470 | 2 | 964 992 | 221 639 of 639 | 35 100% |
| `pass-access-rights` | 3,458 | 2,295 | 5 | 0 1,043 986 973 456 | 0 45 443 516 546 of 546 | 0 8 81 95 100% |
| `pass-derive-wire` | 1,820 | 1,470 | 2 | 977 843 | 245 488 of 488 | 50 100% |
| `pass-derive-errors` | 2,788 | 2,145 | 3 | 919 995 874 | 43 165 456 of 456 | 9 36 100% |
| `pass-tree-shared` | 239 | 420 | 1 | 239 | reached by 896 pairs | |
| `templates` | 276 | 240 | 1 | 276 | reached by 443 `tree.nodes` pairs | |
| `validate` | 589 | 450 | 1 | 589 | 699 pairs | |
| relay order | 163 | 105 | 1 | 163 | 688 pairs | |
| `pass-link` | 71 | 105 | 1 | 71 | 149 pairs | |

- The skeletons of `tree.schemas` and `tree.nodes` alone are estimated at the PR size (4,080 and 4,245 Rust lines); the spike's ratio counts the rustdoc of public functions, which most pass functions (`pub(crate)`) do not carry.
- The progressive oracle of the two largest halves is a cliff: a pair reaches about a third of a half's lines, and the gain order completes few pairs until the shared middle is in. The earlier estimate of 65-83% of pairs at half a half's lines reads the same curve at 50% of the whole files' lines (6,111 and 6,973, types, imports and the shared files included), that is about 3,000 to 3,500 function lines: the end of brief 4 here for `tree.schemas` (56%) and `tree.nodes` (53%). The `tree.schemas` shares count the service reach under its pairs (section 6).
- `access.identity` and `tree.nodes` keep their TypeScript tests as hand-ported Rust tests: no fixture conversion covers them.
- Validate keeps the TypeScript messages: the spike shows the ajv-shaped conversion ports nearly one to one over `jsonschema`.

## 8. Wave plan

- Wave 1: the seam PR (Opus, effort high); lane `stages`: validate, the relay order and link (about 820 lines); lane `shared`: naming, `pass-tree-shared` and templates (about 970 lines). Validate and the relay order come first because `compile` reaches them on every fixture.
- Wave 2: `tree.nodes`, `tree.schemas` and `access.rights`, longest first, three lanes at a time, one PR per brief, Sonnet at effort medium. The first two lanes are the pilot.
- The oracle gives little early feedback on the two largest halves: for `tree.schemas` and `tree.nodes` it compares 0 pairs after brief 1, 25 and 73 after brief 2, 129 of 896 and 92 of 730 after brief 3; most pairs come with briefs 4 and 5. Briefs 1 to 3 of those halves (the skeleton and about 2,000 TypeScript lines) are checked only by `cargo check`, clippy, the unit tests of their bricks and the 25 to 129 pairs they complete; a mismatch found in brief 4 may sit in code merged by brief 2 or 3, and the restart rule of PORTING.md applies to the brief that finds it. `access.rights` compares nothing after its skeleton-only brief 1, then 443 of 546 pairs after brief 2.
- An Opus pattern review after the first merged brief that ports function bodies; its findings amend this note before the next briefs.
- Wave 3, as lanes free up: `derive.errors`, `access.identity`, `derive.wire`.
- A lane rebases on its base branch between briefs and reruns the whole oracle, not only its half.

## 9. Tests

- The oracle compares each half's delta and diagnostics; converted TypeScript tests are fixtures. A lane hand-ports only what no fixture reaches: cases built on a fake service or context, the PORTING.md section 2 edge rows its functions touch, the stable bricks (naming, templates, `text.rs`, the `seampact-ir` helpers), and the `checkTextExample` cases beyond the four calls the fixtures record.
- PORTING.md section 6 says the same.

## Spike evidence

A scratch cargo project, deleted after the note:

- `jsonschema` 0.61.2 against ajv on the 11 invalid layers of the fixtures with validate diagnostics (2,456 ajv errors). `jsonschema` emits no `if` errors (the TypeScript conversion ignores ajv's) and no inner `propertyNames` errors (the TypeScript conversion skips ajv's). With those removed and the `AnyOf`/`OneOfNotValid` contexts flattened in `iter_errors`, the (keyword, instance path) list equals ajv's in order in 10 of 11 documents, both fixtures at the 200-error cap included; the eleventh has the same set in another order, and is sorted after, with no cap. `evaluate().iter_errors()` gives the same counts. The parent schema (markers, description, properties) is read through `absolute_keyword_location` into the embedded schemas.
- The scope of section 3 compiles with three lifetimes and fails with one.
- A replay miss returned as `PassError::Internal` through `&dyn TreeSchemaService` propagates with `?`.
- A `NotPortedYet` after a collision report leaves the report in the half's sink, which the caller drops.
