---
name: seampact-rust-port-ts
description: The procedure for porting a seampact TypeScript module to Rust for 2.0.0, from a port brief to a green oracle and a hand-back. Use when a task asks to port TypeScript files of the compiler, OpenAPI, diff, lint, CLI or a generator family to a Rust crate, or a repository script to cargo xtask.
---

# Porting a TypeScript module to Rust

Rules: PORTING.md, cited by section. Rust style: the `seampact-rust` skill.

1. Read the brief, the design note section it names and its TypeScript files; nothing else unless a step needs it (no other ADR section; a TypeScript test only to list its behaviours). The design note fixes the crate API, core types, ownership and errors: never redesign them. A gap or a contradiction goes under "For the lead", then stop.
2. For each TypeScript function, note its steps, its diagnostics and the section 2 rows it touches.
3. Port function by function (section 1). Before porting a helper, `rg` the crates for an existing port and reuse it (trace line `merged:`). Add each function to `trace.tsv` as you go.
4. Compile loop (section 7), then tests (section 6), then the oracle loop on the brief's fixture subset (section 4): first mismatch only; 3 loops on the same mismatch: commit what is green, write the mismatch and what you tried in the report, stop and hand back (restart rule).
5. Gate (section 8) on the branch rebased on `feat/rust-core`. Then check your diff against each rule of `seampact-rust` below "Lints": clippy checks none of them. A lane never invokes `rust-review`.

Hand-back: the lines the brief asks for; details in the report.
