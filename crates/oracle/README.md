The oracle harness of the Rust port: reads fixtures/expected/, compares a compiler subject's outputs with it under differences.yaml, and gives the verdict of `cargo xtask oracle`. A run gives each fixture a time limit (120 s by default, `--time-limit <seconds>` changes it): a fixture past it is named and fails the run.

## Reading a run

- `cargo xtask oracle [<glob>] [--half <name>]`: the glob, quoted, selects fixture paths relative to `fixtures/`; `--half tree.nodes` compares that pass half's delta and diagnostics alone.
- The first line counts fixtures, compared, match, differ; `service calls` and `rule ids` lines follow when the run checks them; each `oracle:` line is a problem that fails the run (an internal error, a stale difference, an expected file no fixture produces).
- Only the first failing mismatch prints: its fixture, file, JSON pointer, a summary, then the expected and actual lines around it.
- Mismatch kinds: `Value`, `Added`, `Removed` (an entry can accept them), `MemberOrder`, `Text` (layout, escapes, number notation) and `Unparsable` (no entry accepts them).
- A `differences.yaml` entry matches by fixture globs, output, optional api, half and JSON pointer (`*` for one segment) or generated path, plus its `change` kind and optional `from` and `to` values; an entry that matches nothing fails the run as stale.
- A new entry comes with a test in `crates/oracle/tests/oracle_run.rs` showing the committed differences accept it.
