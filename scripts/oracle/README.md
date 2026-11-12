Expected outputs of every fixture and the differential checks of the Rust port: the oracle CLI (scripts/oracle).

The TS compiler is the oracle of the 2.0.0 Rust port (`docs/maintainers/rust-rewrite.md`, "How the port is checked"). While it lives, `check` keeps the committed expected outputs current; the Rust harness compares its own outputs with the same files.

## Commands

Run from the repository root; the CLI relaunches itself with the flags the compiler's sources need.

- `node scripts/oracle/cli.ts write [<glob>]`: compile the fixtures and rewrite `fixtures/expected/<fixture path>/`.
- `node scripts/oracle/cli.ts check [<glob>]`: compile and compare; prints `oracle: <n> fixtures, <m> match, <k> differ`, then the first mismatch (fixture, file, JSON pointer, 3 lines of context each side). Exit 1 on a mismatch.
- `node scripts/oracle/cli.ts coverage`: every diagnostic rule id the compiler can emit against the expected `diagnostics.json` files; lists the uncovered ids and writes `fixtures/expected/rule-coverage.json` (`{ "<rule id>": ["<fixture path>", ...] }`, `[]` when uncovered). The ids are read from the compiler sources (`rule-ids.ts`): `XRule` union types, `rule: "..."` literals and full `"seampact/<stage>/<rule>"` literals; the finalize stage's run-time schema and invariant rules are not listed.

A glob matches fixture paths: `**` any path, `*` one segment, a path without glob characters also matches what is below it.

## Fixtures and expected files

A fixture is a directory under `fixtures/` holding `workspace.yaml` or `api.yaml` (`fixtures/expected/` is left out), sorted by UTF-16 code units. `excluded.json` lists the fixtures the oracle cannot compile alone (`fixtures`) and those whose halves it does not write (`halves`), each with a one-line reason.

Per fixture, under `fixtures/expected/<fixture path>/`:

- `diagnostics.json`: `{ "workspace": [...], "apis": [{ "api", "diagnostics": [...] }] }`, in the order the compiler returns them;
- `ir/<api>.json` and `source-map/<api>.json`: the bytes the IR writer emits (those of `seampact compile --out`);
- `halves/<api>/<NN>-<half>.json`: what each pass half wrote, in run order (`NN` is the position in `pipelineHalves`; a half that did not run has no file), in the convention of `packages/core/compiler/src/pipeline/draft-fixture.ts`.

## Intended differences

`fixtures/expected/differences.yaml` (schema `differences.schema.json`, reader `differences.ts`) lists the differences between the TS oracle and the Rust port that are intended. The Rust harness accepts a mismatch only when exactly one entry matches it (fixture glob, output, pointer or generated path, change); an entry that matches no mismatch is stale and fails the gate. `format` applies to `generated` output only. The TS `check` ignores the file: TS is the `from` side.
