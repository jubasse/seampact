---
name: seampact-rust-port-ts
description: The procedure for porting a seampact TypeScript module to Rust for 2.0.0, from a port brief to a green oracle and a hand-back. Use when a task asks to port TypeScript files of the compiler, OpenAPI, diff, lint, CLI or a generator family to a Rust crate, or a repository script to cargo xtask.
---

# Porting a TypeScript module to Rust

Rules: [PORTING.md](../../../PORTING.md) (cited by section below). Rust style: the `seampact-rust` skill.

## Inputs (from the brief)

The brief gives: the TypeScript files to port, the target crate and its designed types (design note section), the TypeScript test cases to port as a list, the fixture subset, the oracle command, the skip list and the call cap (template below). Read nothing else unless a step needs it: no ADR beyond the named section, no TypeScript test bodies beyond listing their behaviours.

## Steps

1. Read the design note section: the crate API, core types, ownership and errors are given; do not redesign them. A gap or a contradiction goes under "For the lead", then stop.
2. Read the TypeScript files of the brief. For each function, note its steps, the diagnostics it emits and the traps of PORTING.md section 2 it touches.
3. Port function by function, keeping the algorithm and function shape (section 1). Add each one to the crate's `trace.tsv` as you go, skips and merges included with their reason (every TypeScript function of the brief's files has a line).
4. Compile loop: `cargo check -p <crate> --message-format short` until clean, then clippy.
5. Tests: list the behaviours of the TypeScript tests the brief names, write Rust tests of them (section 6), then edge-value tests for each section 2 row the module touches. Run `cargo nextest run -p <crate>`.
6. Oracle loop on the fixture subset (section 4): read the first mismatch only, fix, repeat. Three loops on the same mismatch: stop and hand back with the mismatch and what you tried (restart rule).
7. Commit each green step with named files only (section 7).
8. Gate on the branch rebased on develop (section 8), the trace check, then the oracle on every fixture. Invoke `rust-review` on your diff before hand-back and fix what it finds.

## Port brief

The lead fills this template for each lane: one agent per 500-1,000 TypeScript lines.

```
Invoke the skills seampact-rust, seampact-rust-port-ts and rust-best-practices first; invoke rust-review before hand-back.
Task: <port of ... to crate ...>; worktree, branch, tip, report path.
TS files: <paths>; keep their algorithm and function shape (PORTING.md section 1), each function on a trace.tsv line (skips and merges included). Section 2 rows touched: <rows>; write a Rust test on the edge values of each.
Target crate: <name>, design note section <n>, with its designed types (do not redesign them).
TS test cases to port, as a list: <behaviour per line>.
Fixture subset and oracle command: <fixtures>, <command>.
Skip list: <functions or files never ported>.
Call cap: <60 | 100 | 140>.
Hand-back: tip, gate and oracle result, functions against trace.tsv, loops used, items for the lead.
```

## Never

- Edit an expected output, `fixtures/expected/differences.yaml` or a TypeScript source.
- Special-case a fixture, weaken or delete a test, leave `todo!`, `unimplemented!` or `#[ignore]` (section 5).
- Port the TypeScript shape where the design note gives another one, or copy a helper that exists.

## Hand-back

The lines the task prompt asks for: tip, gate and oracle result (counts), functions ported against `trace.tsv`, loops used, items for the lead. Details go to the report file.
