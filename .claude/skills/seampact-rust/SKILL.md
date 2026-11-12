---
name: seampact-rust
description: Seampact's overrides of general Rust practice for the 2.0.0 Rust core. Use when writing, reviewing or fixing any Rust code, Cargo.toml or Rust test in the seampact repository; where it disagrees with rust-best-practices, this skill wins.
---

# Rust in seampact

General idiom comes from `rust-best-practices` and `rust-review`. This skill lists where seampact differs or is stricter. The porting rules are in [PORTING.md](../../../PORTING.md); a port follows the `seampact-rust-port-ts` skill.

## Stricter than the general guide

- No `unwrap`, `expect`, `panic!`, `unreachable!`, `todo!`, `unimplemented!` or indexing that can panic (`clippy::indexing_slicing`) outside tests, even for invariants: a broken invariant is an internal diagnostic with its own exit code. Lock poisoning and "cannot happen" branches included. No silent fallback or placeholder value (`unwrap_or_default`, `unwrap_or(Ordering::Equal)`); a fallible lookup returns `Result`, never a forced total type.
- No `anyhow` anywhere, binaries included. Libraries: one `thiserror` enum per crate for environment failures; user faults are diagnostics, never errors.
- `unsafe_code = "forbid"` in every crate; no exception without a user decision.
- `#[allow]` and `#[expect]` need `reason = "..."`; the workspace allow list is short and lives in the root `Cargo.toml`.
- `print!`, `println!`, `eprintln!` only in the CLI output module.

## Determinism

- Output depends only on input: no clock, randomness, environment or thread timing in the compiler or generators.
- A collection that is iterated into output is `IndexMap` or `IndexSet`, or sorted with the UTF-16 compare helper. `HashMap` only for lookups. `BTreeMap<String, _>` iterates in byte order, which is not the IR's order.
- Parallel work (`rayon`) only where the output order is fixed afterwards.
- JSON for the IR and OpenAPI goes through the canonical writer; numbers through the ECMAScript number-text helper.

## Text and paths

- Count what the TypeScript counts: load limits, positions and columns in UTF-16 units through the text helper, JSON Schema string lengths in code points. Spans store byte offsets.
- Paths are UTF-8 (`camino`); output paths go through the validated relative-path type, which refuses `..`, absolute paths and names that differ only by case or Unicode normalisation.
- Line endings: LF in every written file; input accepts CRLF.

## Shape

- Airy code: a blank line between steps, after a group of `let`, before `return`, `if`, `match`, loops and after a block; at most 3-4 levels of nesting (early return, `let ... else`, extract a function).
- Long precise names (`pending_operation_ids`, not `ids`); a function name that makes a comment unnecessary.
- Comments only for a non-obvious reason; rustdoc on every public item of a library crate (`missing_docs`), first line a sentence.
- One concept per module: its types, traits and functions together; one shared helper, never a copy.
- Named constants, no magic values; no boolean flag parameters (an enum instead).

## Dependencies

- Versions pinned once in `[workspace.dependencies]`; a crate uses `dep.workspace = true`.
- Each new dependency is named with its reason in the PR body and passes `cargo deny check` (MIT-compatible licences, advisories, no duplicate versions, known sources). `cargo machete` finds none unused.
- Crate docs through context7, at the pinned version.

## Tests

- Unit tests in a `tests` module beside the code; integration tests in `tests/`; run with `cargo nextest`.
- Test behaviour, not implementation; a bug fix starts with a test that fails before it.
- Fixture-driven tests read `fixtures/` and `fixtures/expected/`, never inline copies of them.
