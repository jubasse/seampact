---
name: seampact-rust
description: How Rust is written in seampact's 2.0.0 Rust core, beyond what PORTING.md and clippy enforce. Use when writing, reviewing or fixing any Rust code, Cargo.toml or Rust test in the seampact repository; where it disagrees with rust-best-practices, this skill wins.
---

# Rust in seampact

PORTING.md sections 1-8 (JavaScript traps, errors, oracle, gate) and AGENTS.md "Code style" apply and are not repeated here.

## Lints

- The workspace lints (root `Cargo.toml`, `clippy.toml`) run clippy `all` and `pedantic` under `-D warnings`, require `missing_docs` and a `reason` on every `allow` or `expect`, forbid `unsafe_code`, and deny `unwrap_used`, `expect_used`, `panic`, `unreachable`, `todo`, `unimplemented`, `dbg_macro`, `exit`, `indexing_slicing`, `string_slice`, `print_stdout` and `print_stderr`; `clippy.toml` lets `#[test]` functions unwrap, expect, panic and index.
- Fix what a lint reports, never silence it. Only when a lint is wrong for one item: `#[expect(clippy::<name>, reason = "...")]` on that item. Printing is allowed only in the CLI output module.
- The fix for a denied panic, unwrap or index is PORTING.md section 3 (match the shape, or return the `InternalError`), lock poisoning included; never `.expect()` or a fallback value the TypeScript does not have (a TypeScript `?? x` ports as `unwrap_or(x)`).

## Ownership

- Unique ownership. `Rc`, `Arc`, `RefCell` or `Mutex` only when the design asks for sharing or interior mutability, never to quiet the borrow checker; `Rc`, `Arc`, `Box`, `RefCell` and third-party types stay out of signatures other crates call unless the design note puts them there.
- Never `.clone()` only to end a borrow. Try in order: a named `let` or a block to shorten the borrow; typed intermediates to find the failing step; `mem::take`, `mem::replace` or `Option::take` to move out of `&mut`; split a struct so disjoint fields borrow apart (tracked inside one function, not across method calls); clone small immutable data on purpose; indices into an owning `Vec` last. No self-referential struct.
- An accessor reading a `&'run` field returns `&'run T`, not the elided borrow of `&self`, so a caller can keep it while it reports. Where the TypeScript returns part of its argument, return a borrow of it, not an owned copy.
- Take `T` by value only to store or consume it, never `&T` plus an inner `.clone()`. Return several values as a tuple or struct, not through `&mut` out-parameters.
- Structs own their data (`String`, `Vec`) unless the design makes a borrow (a view over a draft); a lifetime gets a descriptive name (`'draft`, `'run`, `'src`), never `'a`.
- Build with `let mut`, then rebind `let value = value;` once later code must not mutate it.

## Types

- TypeScript to Rust: a string-literal union is a fieldless enum with its text in one `as_str`; a discriminated union an enum with data; an optional property `Option<T>`; `T | undefined` from a lookup `Option<&T>`; a `flag: boolean` option a two-variant enum (no `bool` parameter in a shared signature: clippy only flags three or more).
- Invalid states unrepresentable: an enum, not a flag plus fields meaningful "only when"; newtypes for ids and units; a fallible constructor (`try_new`) validates once. `Option` for absence, never a sentinel (`-1`, `""`). Named fields; tuples only for one-field newtypes and very local code.
- No class hierarchy, `Manager` or `Helper` type, or `Deref` to a "base" struct. Traits only for generic code or `dyn` dispatch the design asks for: concrete type, then generic, then `dyn`. A function with a clear receiver is a method. Closure bounds `FnOnce`, else `FnMut`, else `Fn`; a closure parameter goes last. No macro where a function, generic or trait does.
- `Debug` on every type; `Clone`, `PartialEq`, `Eq`, `Hash`, `Default` when every field allows and they mean something; `Copy` only for small plain types; `PartialOrd` with `Ord` when a total order exists. A hand-written `Ord` comes with `PartialEq`, `PartialOrd` and `Hash` on the same fields.
- Match an enum this repository owns (IR unions, closed catalogues) with no `_` arm, so a new variant breaks every match; `_` only for foreign or `#[non_exhaustive]` types.
- Names: no `get_` prefix; constructors `new`, `try_new`, `from_x` (plus `From` when it is a real conversion); error types verb-object-error (`ParseDurationError`); acronyms as one word (`JsonValue`).
- Visibility: private, then `pub(crate)`, then `pub`; fields private unless the struct is passive data; each public item reachable at one path, re-exported by name.
- Parameter order is the same across a crate: call-specific first, shared context (half context, reporter) last.

## Numbers

- `f64 as i64` (`cast_possible_truncation`) saturates and turns NaN into 0, unlike JS `x | 0`: check `is_finite` and the range first, or use the number helper.
- `+`, `-`, `*` on input-sized integers panic in debug and wrap in release: `checked_` or `saturating_` as the TypeScript number would behave, `wrapping_` only where it relied on 32 bits.

## Errors

- `anyhow` only in the CLI binary and `xtask`. A library has one `thiserror` enum per crate, not a workspace-wide one; `#[from]` so `?` works, `map_err` only for a foreign error or added context; messages lowercase, no trailing period.
- Fallible sort keys: collect them into `Result<Vec<_>, _>` first, then sort on total keys; never a comparator that stores an error and answers `Ordering::Equal`.

## Idioms

- Iterators for short top-down pipelines; collect fallible steps into `Result<Vec<_>, _>`, then `?`; a `for` loop when the body is long, does several jobs or returns early. Bind a long chain to a typed variable (`let names: Vec<&str> = ...`) rather than a turbofish.
- `entry` for insert-or-update, `Vec::with_capacity` when the size is known, `extend` over push loops.
- Imports: one `use` per module path; types and traits unqualified, free functions qualified by their module (`mem::take`, `fs::read`).
- A value another module or crate already names (a derivation id, a rule id) is imported, never retyped; a new magic value is a `const` whose doc line says where it comes from.
- Paths are UTF-8 (`camino`); output paths go through the validated relative-path type (refuses `..`, absolute paths, names that differ only by case or Unicode normalisation). Written files use LF; input accepts CRLF.
- Blank line after a group of `let`, before `return`, `if`, `match` and loops, after a block.

## Modules and docs

- One concept per module, named after its main item; a non-leaf module holds only `mod` lines and re-exports. Group by use case, never by kind (`types.rs`, `errors.rs`, `utils.rs`); no prelude of your own.
- Rustdoc: first sentence one line of about fifteen words (the listing summary); document what the signature cannot say (preconditions, ownership transfer, a TypeScript quirk kept on purpose), never restate the name; link with `` [`Type`] ``. No design journal or rule table in comments.

## Crates

- A new crate takes `[lints] workspace = true` and `dep.workspace = true`. A dependency you add follows PORTING.md section 7; a duplicate version it brings (cargo deny only warns) is named with its reason in the hand-back; crate docs through context7 at the pinned version.
- Parallel work (`rayon`) only where the output order is fixed afterwards (indexed `collect`).

## Tests

- Unit tests in `#[cfg(test)] mod tests` beside the code, integration tests in `tests/`; fixture-driven tests read `fixtures/` and `fixtures/expected/`, never inline copies. A harness two crates need (fake context, fake service) is shared, never copied.
- Test behaviour and properties (round trip, idempotence, order), never restated constants or match arms the oracle covers.
- Assertions carry context: `assert_eq!(actual, expected, "input {input:?}")`.
