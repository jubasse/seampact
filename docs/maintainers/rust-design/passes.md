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
| `seampact-ir-check` | `crates/ir-check` | the `JsonValue` to `serde_json::Value` conversion `jsonschema` reads, kept apart so a later stage reuses it without depending on validate | `serde_json` |
| `seampact-validate` | `crates/validate` | `validate/` | `ir-check`, `jsonschema` |

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
pub enum PassError {
    NotPortedYet { function: &'static str },   // the TypeScript function name
    Internal(InternalError),
}
impl From<InternalError> for PassError { .. }
```

- `PassError` lives in `seampact-pipeline` because `TreeSchemaService` methods return it: a later half calling a service method that reaches an unported `tree.schemas` function stops with `NotPortedYet`, not with a wrong answer.
- Each pass crate builds it only through `src/not_ported.rs`: `pub(crate) fn not_ported_yet(function: &'static str) -> PassError`. Every pass function returns `Result<_, PassError>`.
- A stub is a whole function with the TypeScript signature and a `not_ported_yet("<tsName>")` body. A branch reaching an unported callee needs no stub of its own: the callee's error propagates through `?`. Briefs port whole functions.
- Each crate carries `#![expect(dead_code, reason = "functions reached only by stubs until the half's last brief")]` in `lib.rs` while stubs exist.
- The dispatch maps `NotPortedYet` to `HalfRun::NotPorted` and `Internal` to `Err(InternalError)`; the oracle counts a not-ported pair as skipped, never as a match.
- Diagnostics reported before a `NotPortedYet` are dropped for that pair by construction: `run_halves` and `run_fixture_half` give each half a fresh sink and merge its output and diagnostics only on `Ok`.
- End of a half: its last brief deletes `not_ported.rs` and the `expect`; `rg 'NotPortedYet|not_ported_yet' crates/pass-<half>/src` prints nothing and `cargo xtask oracle --half <half>` reports 0 not ported (for `tree.schemas`, also 0 not-ported service calls, section 5).
- End of the layer: one scripted change removes the `NotPortedYet` variant and `HalfRun::NotPorted`, and turns `PassError` into `InternalError` in every signature.

## 3. Scope, owned output and cross-half helpers

The TypeScript `scope` objects mutate the draft; the Rust halves never do (loader and pipeline note, section 5). A half reads the draft and writes its owned output through one scope struct:

```rust
pub(crate) struct DeriveWireScope<'draft, 'half, 'run> {
    draft: &'draft DraftIr,
    context: &'half mut HalfContext<'run>,
    schemas: &'draft dyn TreeSchemaService,
    output: DeriveWireOutput,                    // the accumulator
    reported_collisions: HashSet<String>,        // lookup only
    setting_faults: IndexMap<String, SettingFault>, // iterated: insertion order kept
}

impl DeriveWireScope<'_, '_, '_> {
    fn query_params_of(&self, operation: usize) -> impl Iterator<Item = &Param>;  // draft list chained with the additions
    fn add_query_param(&mut self, operation: usize, param: Param);
    fn into_output(self) -> DeriveWireOutput;
}
```

- Three lifetimes: `HalfContext<'run>` is invariant behind `&mut`, so one shared lifetime does not compile (spike).
- The accumulator is the half's owned output, built up front with one entry per draft operation (`operations[i]` matches `draft.operations[i]`); a half-level member (`api_wire`) starts from its default.
- The collision checks of TypeScript read the mutated draft, that is the declared elements plus those already derived. Rust reads a merged view: one `<member>_of(operation)` method per checked list, the draft list chained with the accumulator's. Writes go only through `add_<member>`, so the view and the output cannot drift.
- A loop over draft elements that also writes copies the reference first (`let draft = scope.draft;`), so the loop borrows the draft, not the scope.
- A TypeScript `Set` used only for lookups is a `HashSet`; a `Map` or `Set` that is iterated is an `IndexMap` or `IndexSet`.
- The half's entry builds the scope, runs the TypeScript body and answers `scope.into_output()`; the dispatch merges it with `merge_into`.
- `IrSensitiveReach`: `seampact-ir`, `sensitive` module (section 1), never a local copy in `pass-derive-errors`.
- `quote`: `seampact-diagnostics` `text.rs` (section 1), from the seam PR on.
- `treeNodesBodyLimit`: `pass-tree-nodes`, public; the coverage script orders functions that other halves call right after the spine, so it lands in brief 2 of `tree.nodes`.

## 4. The seam PR

One PR, before any pass lane, small enough to land first:

- `PassError` (section 2); `TreeSchemaService` methods return `Result<_, PassError>`.
- `LaterHalf` in `seampact-pipeline` `halves.rs`: the five halves after `tree.schemas`, so the service argument cannot be missing where it is needed.
- Dispatch in `crates/compiler/src/half_run.rs`:

  ```rust
  pub enum TreeSchemasRun { Merged(Box<dyn TreeSchemaService>), NotPorted }
  pub fn run_tree_schemas(draft: &mut DraftIr, context: &mut HalfContext<'_>)
      -> Result<TreeSchemasRun, InternalError>;
  pub fn run_half(half: LaterHalf, draft: &mut DraftIr, context: &mut HalfContext<'_>,
      schemas: &dyn TreeSchemaService) -> Result<HalfRun, InternalError>;
  ```

  Each arm calls its crate's entry function and maps `PassError` (section 2).
- Six pass crates and `seampact-pass-link`, each with its entry function as a stub, `src/not_ported.rs`, the `expect`, an empty `trace.tsv` and `pub const RULE_IDS: &[RuleId] = &[];`, which brief 1 of the half fills. `rule_id_registry()` of `seampact_compiler::oracle` reads every crate's `RULE_IDS`.
- `text.rs` with `quote`, `unsafe`, `accessRightsQuoted` and the `JSON.stringify`-order writer (section 1), with their unit tests.
- Oracle `run_half` answers `HalfOutput { delta, diagnostics }`; the harness compares `diagnostics` with `<NN>-<half>.diagnostics.json` beside the delta (an absent file is `[]`), both sorted as `diagnostics.json` is.
- `seampact-oracle` `expected.rs` reads `schema-calls/<api>.json` into `Vec<RecordedCall { method, args, answer: Option<JsonValue> }>` and hands it to `run_half`.
- `RecordedSchemaService` in `seampact_compiler::oracle`: answers a call by looking up the canonical JSON of `[method, args]` among the recorded calls; a miss is `PassError::Internal` naming the method and its arguments; an absent `answer` is `None`. `run_fixture_half` runs every half after `tree.schemas` against it, which lifts today's gate that answers `NotPorted` for them.
- The `oracle_run.rs` test stops pinning the list of stale entries: it asserts only that every problem line is a stale-difference line.

## 5. The service replay check

The halves after `tree.schemas` are compared against the recorded service; the Rust service is checked against the same records:

- A fourth `OracleSubject` method, `replay_schema_calls(fixture, api, calls) -> SubjectAnswer<Vec<Option<JsonValue>>>`: build the Rust service by running `tree.schemas` on the fixture's api, then answer every recorded call in order.
- The harness compares each answer with the recorded `answer` by value. It runs within `cargo xtask oracle` whenever the selection includes `tree.schemas` (no `--half`, or `--half tree.schemas`), with the verdict line `service calls: <matched> of <n>, <not ported> not ported`.
- An oracle mode, not a separate xtask step: it reuses the fixture walk, the `differences.yaml` matching and the gate's oracle step. The end of `tree.schemas` requires 0 not-ported service calls.

## 6. Coverage tables

- `scripts/rust/pass-coverage.ts` writes one TSV per crate in `docs/maintainers/rust-design/passes/` (`pass-<half>.tsv`, `pass-tree-shared.tsv`, `pass-link.tsv`, `validate.tsv`, `compiler-relay-order.tsv`, `templates.tsv`) plus `foreign.tsv`. Columns: `brief`, `function`, `file`, `lines`, `size`, `pairs` (pairs reaching the function over the pairs of the half). Function names are those of `trace.tsv` (`listTypeScriptFunctionRanges` of `scripts/rust/trace.ts`).
- Rerun after a fixture change: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/pass-coverage.ts`. The lead reruns it once the converted test fixtures land; the brief numbers and counts below are measured on the current fixtures.
- A function no fixture reaches has `pairs` 0 and sits in the last brief; its behaviour comes from the converted fixtures or a hand-ported test (section 7).

## 7. Briefs

Cut rule, applied by the script per crate:

1. Brief 1: every function's signature with a `NotPortedYet` body, plus the spine (the entry function and the functions every pair reaches) and `RULE_IDS`.
2. Then the functions other halves call.
3. Then, greedily, the function that completes the most pairs per TypeScript line (a pair completes when every function it reaches is ported).
4. Then the rarely reached, the never reached last.
5. A brief closes past about 1,000 function lines; a function is never split.

A brief names its functions with TypeScript line ranges (`rg '^<n>\t' docs/maintainers/rust-design/passes/<crate>.tsv`), the oracle command (`cargo xtask oracle --half <half>`, or `cargo xtask oracle` for the stages) and the TypeScript test files of the directory; for these it says "ledger from the converted fixtures": the converted fixtures carry their cases, and the lane hand-ports only what section 8 lists.

Measured (function lines per brief; pairs comparable after each brief, foreign dependencies ignored):

| Crate | Lines | Briefs | Lines per brief | Comparable pairs after each brief |
|---|---|---|---|---|
| `pass-tree-schemas` | 4,721 | 5 | 1,218 992 966 996 549 | 2 29 228 277 284 of 284 |
| `pass-tree-nodes` | 4,725 | 5 | 1,016 961 993 990 765 | 2 25 112 207 229 of 229 |
| `pass-access-identity` | 1,956 | 2 | 995 961 | 79 171 of 171 |
| `pass-access-rights` | 3,458 | 4 | 1,070 1,000 959 429 | 5 98 111 123 of 123 |
| `pass-derive-wire` | 1,820 | 2 | 985 835 | 58 116 of 116 |
| `pass-derive-errors` | 2,788 | 3 | 1,136 998 654 | 17 41 109 of 109 |
| `pass-tree-shared` | 239 | 1 | 239 | reached by 284 pairs |
| `templates` | 276 | 1 | 276 | reached by 166 `tree.nodes` pairs |
| `validate` | 589 | 1 | 589 | 242 fixtures |
| relay order | 163 | 1 | 163 | 231 fixtures |
| `pass-link` | 71 | 1 | 71 | 40 fixtures |

- `access.identity` and `tree.nodes` keep their TypeScript tests as hand-ported Rust tests: no fixture conversion covers them.
- Validate keeps the TypeScript messages: the spike shows the ajv-shaped conversion ports nearly one to one over `jsonschema`.

## 8. Wave plan

- Wave 1: the seam PR (Opus, effort high); lane `stages`: validate, the relay order and link (about 820 lines); lane `shared`: naming, `pass-tree-shared` and templates (about 970 lines). Validate and the relay order come first because `compile` reaches them on every fixture.
- Wave 2: `tree.nodes`, `tree.schemas` and `access.rights`, longest first, three lanes at a time, one PR per brief, Sonnet at effort medium. The first two lanes are the pilot.
- An Opus pattern review after the first merged half brief; its findings amend this note before the next briefs.
- Wave 3, as lanes free up: `derive.errors`, `access.identity`, `derive.wire`.
- A lane rebases on its base branch between briefs and reruns the whole oracle, not only its half.

## 9. Tests

- The oracle compares each half's delta and diagnostics; converted TypeScript tests are fixtures. A lane hand-ports only what no fixture reaches: cases built on a fake service or context, the PORTING.md section 2 edge rows its functions touch, the stable bricks (naming, templates, `text.rs`, the `seampact-ir` helpers), and `checkTextExample`, which no fixture calls.
- PORTING.md section 6 says the same.

## Spike evidence

A scratch cargo project, deleted after the note:

- `jsonschema` 0.61.2 against ajv on the 11 invalid layers of the fixtures with validate diagnostics (2,456 ajv errors). `jsonschema` emits no `if` errors (the TypeScript conversion ignores ajv's) and no inner `propertyNames` errors (the TypeScript conversion skips ajv's). With those removed and the `AnyOf`/`OneOfNotValid` contexts flattened in `iter_errors`, the (keyword, instance path) list equals ajv's in order in 10 of 11 documents, both fixtures at the 200-error cap included; the eleventh has the same set in another order, and is sorted after, with no cap. `evaluate().iter_errors()` gives the same counts. The parent schema (markers, description, properties) is read through `absolute_keyword_location` into the embedded schemas.
- The scope of section 3 compiles with three lifetimes and fails with one.
- A replay miss returned as `PassError::Internal` through `&dyn TreeSchemaService` propagates with `?`.
- A `NotPortedYet` after a collision report leaves the report in the half's sink, which the caller drops.
