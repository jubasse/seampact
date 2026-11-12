---
name: seampact-rust-port-ts
description: The procedure for porting a seampact TypeScript module to Rust for 2.0.0, from a port brief to a green oracle and a hand-back. Use when a task asks to port TypeScript files of the compiler, OpenAPI, diff, lint, CLI or a generator family to a Rust crate.
---

# Porting a TypeScript module to Rust

Rules: [PORTING.md](../../../PORTING.md) (cited by section below). Rust style: the `seampact-rust` skill.

## Inputs (from the brief)

The TypeScript files to port, the target crate and its design note section, the fixture subset, the oracle command, the skip list and the call cap. Read nothing else unless a step needs it: no ADR beyond the named section, no TypeScript test bodies beyond listing their behaviours.

## Steps

1. Read the design note section: the crate API, core types, ownership and errors are given; do not redesign them. A gap or a contradiction goes under "For the lead", then stop.
2. Read the TypeScript files of the brief. For each function, note its steps, the diagnostics it emits and the traps of PORTING.md section 2 it touches.
3. Port function by function, keeping the algorithm and the decomposition (section 1). Add each one to the crate's `trace.tsv` as you go.
4. Compile loop: `cargo check -p <crate> --message-format short` until clean, then clippy.
5. Tests: list the behaviours of the TypeScript tests the brief names, write Rust tests of them (section 6). Run `cargo nextest run -p <crate>`.
6. Oracle loop on the fixture subset (section 4): read the first mismatch only, fix, repeat. Three loops on the same mismatch: stop and hand back with the mismatch and what you tried (restart rule).
7. Commit each green step with named files only (section 7).
8. Gate on the branch rebased on develop (section 8), then the oracle on every fixture.

## Never

- Edit an expected output, `fixtures/expected/differences.yaml` or a TypeScript source.
- Special-case a fixture, weaken or delete a test, leave `todo!`, `unimplemented!` or `#[ignore]` (section 5).
- Port the TypeScript shape where the design note gives another one, or copy a helper that exists.

## Hand-back

The lines the task prompt asks for: tip, gate and oracle result (counts), functions ported against `trace.tsv`, loops used, items for the lead. Details go to the report file.
