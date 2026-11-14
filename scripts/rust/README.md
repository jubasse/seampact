The trace check of the Rust port: every function of the TypeScript files a crate ports has a line in its `trace.tsv`.

`pass-coverage.ts` writes the per-function coverage tables of the pass halves and the stages before them (`docs/maintainers/rust-design/passes/*.tsv`): which fixtures reach each TypeScript function, cut into port briefs. Run it as its header says, after the expected files change.
