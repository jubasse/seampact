Expected outputs of every fixture and the differential checks of the Rust port: the oracle CLI (scripts/oracle).

The TS compiler is the oracle of the 2.0.0 Rust port (`docs/maintainers/rust-rewrite.md`, "How the port is checked"). While it lives, `check` keeps the committed expected outputs current; the Rust harness compares its own outputs with the same files.

## Commands

Run from the repository root; the CLI relaunches itself with the flags the compiler's sources need.

- `node scripts/oracle/cli.ts write [<glob>]`: compile the fixtures and rewrite `fixtures/expected/<fixture path>/`.
- `node scripts/oracle/cli.ts check [<glob>]`: compile and compare; prints `oracle: <n> fixtures, <m> match, <k> differ`, then the first mismatch (fixture, file, JSON pointer, 3 lines of context each side). Exit 1 on a mismatch.
- `cargo xtask oracle [<glob>] [--half <name>]`: the Rust harness (`crates/oracle`) compares the Rust compiler's outputs with the same files under the intended differences below, prints its own verdict (counts, the first mismatch, the problems) and exits 1 on a failure; `--half` compares one pass half only.
- `node scripts/oracle/cli.ts coverage`: every diagnostic rule id the compiler can emit against the expected `diagnostics.json` files; lists the uncovered ids and writes `fixtures/expected/rule-coverage.json` (`{ "<rule id>": ["<fixture path>", ...] }`, `[]` when uncovered). The ids are read from the compiler sources (`rule-ids.ts`): `XRule` union types, `rule: "..."` literals and full `"seampact/<stage>/<rule>"` literals; the finalize stage's run-time schema and invariant rules are not listed. Coverage fails (exit 1) when an expected `diagnostics.json` holds a rule id no source declares. `check` on the whole tree also reports expected trees of no fixture and keys of `excluded.json` naming no fixture.

A glob matches fixture paths: `**` any path, `*` one segment, a path without glob characters also matches what is below it. A glob that matches no fixture is a usage error (exit 2).

## Fixtures and expected files

A fixture is a directory under `fixtures/` holding `workspace.yaml` or `api.yaml` (`fixtures/expected/` is left out), sorted by UTF-16 code units. `excluded.json` lists the fixtures the oracle cannot compile alone (`fixtures`) and those whose halves it does not write (`halves`), each with a one-line reason.

Per fixture, under `fixtures/expected/<fixture path>/`:

- `diagnostics.json`: `{ "workspace": [...], "apis": [{ "api", "diagnostics": [...] }] }`, in the order the compiler returns them;
- `ir/<api>.json` and `source-map/<api>.json`: the bytes the IR writer emits (those of `seampact compile --out`);
- `halves/<api>/<NN>-<half>.json`: what each pass half wrote, in run order (`NN` is the position in `pipelineHalves`; a half that did not run has no file), in the convention of `packages/core/compiler/src/pipeline/draft-fixture.ts`;
- `halves/<api>/<NN>-<half>.diagnostics.json`: the diagnostics that half reported, sorted as `diagnostics.json` is; written only when the half reported at least one, so an absent file next to a delta means `[]`;
- `schema-calls/<api>.json`: `[{ "method", "args": [...], "answer"? }]`, the calls the halves after `tree.schemas` made to the schema service (`typeUse`, `checkExample`, `queryWire`, `checkTextExample`), deduplicated by method and arguments in the order of the first call; `answer` is absent when the service answered `undefined`; written only when the api has at least one call, so an absent file means no call. One question never has two answers: the writer throws if it does. Four `checkTextExample` calls are recorded, all from converted fixtures.

`fixtures/converted/<half>/<test file stem>/<case>/` holds fixtures converted from the unit tests of the pass halves: one fixture per distinct contract that a test compiled and whose half delta or diagnostics are not empty, with the whole expected tree like every other fixture. They are compiled and compared as any fixture, so `write` and `check` cover them.

## Intended differences

`fixtures/expected/differences.yaml` (schema `differences.schema.json`, reader `differences.ts`) lists the differences between the TS oracle and the Rust port that are intended. Matching, for the Rust harness:

- One mismatch: both JSON values are walked together; a mismatch is one JSON pointer where they differ, a scalar that differs (`value`), a member or array element only in the Rust output (`added`) or only in the TS output (`removed`). Arrays compare by position (a length difference gives `added` or `removed` at each extra index), objects by member name, numbers by their text token (integers above 2^53 compare exactly). For `generated`, one mismatch is one file whose token streams differ (whitespace aside), or a file present on one side only.
- An entry matches a mismatch when all hold: the fixture path (relative to `fixtures/`) matches a glob of `applies.fixtures` (`*` within one path segment, `**` any number of segments, `dir/**` matches `dir` and what is under it, a glob without glob characters matches that path only); `applies.output` is the mismatch's output; the optional `applies.api` and `applies.half` equal the api and the half of the file; `applies.pointer` matches the pointer segment by segment, a segment exactly `*` matching any one segment (a `*` inside a segment, or `**`, is refused by the schema); for `generated`, `applies.path` is a glob over the file path; `change` is the mismatch's kind (`message` needs the pointer's last segment to be `message` or `fix`, `code-renamed` needs `rule`, `code` or `id`); `from`, when present, equals the TS value and `to`, when present, the Rust value (JSON equality, numbers by token).
- A mismatch matched by no entry fails, and one matched by two or more entries fails as ambiguous. An entry that matches no mismatch in the whole run is stale and fails the gate.
- Accepting the mismatches of a file does not excuse the rest of its text: outside the accepted values and members the two files must be byte identical (layout, string escapes, number notation).
- A file present on one side only is a mismatch at the root pointer `""`, which no entry can name: a missing or extra whole file is never acceptable.

`format` applies to `generated` output only. The TS `check` ignores the file: TS is the `from` side.

## Rules without a fixture

`coverage` lists five rule ids that no contract fixture can trigger:

- `derive/error-params`: declared in the rule type, reported nowhere.
- `finalize/id-collision`: `tree/name-collision` refuses the same collisions earlier.
- `tree/relay-unknown`: needs an imported IR from a newer seampact with unknown closed values, which a contract cannot write.
- `load/expansion-limit`, `load/file-too-large`: size budgets too large for a committed fixture; unit tests cover them.

The diagnostics cap is silent: past it, diagnostics are dropped with no marker, so `diagnostics-cap-at` and `diagnostics-cap-over` expect the same output.
