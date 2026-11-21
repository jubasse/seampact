---
name: seampact-rust-port-ts
description: The procedure for porting a seampact TypeScript module to Rust for 2.0.0, from a port brief to a green oracle and a hand-back. Use when a task asks to port TypeScript files of the compiler, OpenAPI, diff, lint, CLI or a generator family to a Rust crate, or a repository script to cargo xtask.
---

# Porting a TypeScript module to Rust

Rules: PORTING.md, cited by section. Rust style: the `seampact-rust` skill.

1. Read the brief, the design note section it names and its context pack (else its TypeScript files by range); nothing else unless a step needs it (no other ADR section; a TypeScript test only to list its behaviours). The design note fixes the crate API, core types, ownership and errors: never redesign them. A gap or a contradiction goes under "For the lead", then stop. Reads: `rg -n -m 8 --max-columns 160`, none past 150 lines.
2. For each TypeScript function, note its steps, its diagnostics and the section 2 rows it touches.
3. Port function by function (section 1). Before porting a helper, `rg` the crates for an existing port and reuse it after reading its signature and `pub use` path (`rg -n 'pub fn <name>' crates/`) (trace line `merged: <path>`, `../<crate directory>/src/<file>.rs#<fn>` for another crate). Add each function to `trace.tsv` as you go.
4. Compile loop (section 7): `cargo check -p <crate> --message-format short` until clean, then `cargo clippy --fix --allow-dirty -p <crate> --all-targets` once (alone, never chained in `&&`), then `cargo clippy -p <crate> --all-targets --message-format short -- -D warnings`. Then tests (section 6), then the oracle loop (section 4): `cargo xtask oracle '<glob>' [--half <name>]`, the glob quoted over fixture ids; loop on the failing fixture's directory (seconds), run the whole half once at the end (minutes). First mismatch only; an internal error first (one cause often fails many fixtures); 3 loops on the same mismatch: commit what is green, write the mismatch and what you tried in the report, stop and hand back (restart rule). A mismatch of a class the brief names as shared is counted in the report with its first fixture, never investigated. Options, `differences.yaml` and mismatch kinds: `crates/oracle/README.md`, not the oracle's sources.
5. `git fetch -q origin && git rebase origin/<base>`, then `cargo xtask gate` once (section 8; it runs the oracle on every fixture), in the foreground with the Bash timeout 600000: it takes 7-9 min. If it still moves to the background, end your turn and wait for its notification: never sleep, poll or kill it. Then check your diff against every rule of `seampact-rust` from "Ownership" down, plus the `map[&key]` and fallback rules of "Lints". A lane never invokes `rust-review`.

Never edit a file outside your owned paths, even uncommitted to test a hypothesis, and read one only once, to place a mismatch (the oracle, a shared crate, xtask): the classifier refuses it and the lane stops. Write the hypothesis and the first fixture under "For the lead".

Hand-back: the lines the brief asks for; details in the report.
