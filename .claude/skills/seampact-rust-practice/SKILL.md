---
name: seampact-rust-practice
description: The general Rust practice a seampact port lane needs, condensed from rust-best-practices (ownership, types, errors, idioms, docs, tests). Use with seampact-rust and seampact-rust-port-ts when writing or fixing Rust in the seampact repository; seampact-rust wins where they differ.
---

# Rust practice for port lanes

A condensed subset of `rust-best-practices`, kept to what a port lane meets. Seampact's own rules (`seampact-rust`, PORTING.md) win where they differ: no panics, `InternalError` through `?`, no `unsafe`, `IndexMap` for output order. Design notes and reviews may still use the full guide.

## 1. Mindset

- Write Rust-shaped code that keeps the TypeScript algorithm and function shape: `Result` for failure, `Option` for absence, enums for unions, ownership for lifetimes of data. No class hierarchies, `Manager` or `Helper` types, `Deref` to a "base" struct.
- Make invalid states unrepresentable: an enum instead of a flag plus "only when" comments, a newtype for an id or a unit, a fallible constructor that validates once.
- Let the tools work: rustfmt formats, clippy checks idiom, the compiler checks memory. Fix a lint rather than silencing it; when one is wrong for one item, `#[expect(clippy::name, reason = "...")]` on the narrowest item.

## 2. Ownership and borrowing

- Prefer unique ownership. `Rc`, `Arc`, `RefCell` and `Mutex` only when shared ownership or interior mutability is the design, never to quiet the borrow checker.
- Never clone only to end a borrow. In order, try: a named `let` for a temporary or a block to shorten a borrow; typed intermediates to see the failing step; `std::mem::take`, `mem::replace` or `Option::take` to move a field out of `&mut`; split a struct so disjoint fields borrow apart (the compiler tracks disjoint fields inside one function, not across method calls); clone small immutable data on purpose; indices into an owning `Vec` as the last resort. No self-referential structs.
- Parameters take the most general borrow: `&str` not `&String`, `&[T]` not `&Vec<T>`, `Option<&T>` not `&Option<T>`. Take `T` by value only when the function stores or consumes it, never `&T` plus an inner `.clone()`. Return several values as a tuple or a struct, not through `&mut` out-parameters.
- Structs own their data (`String`, `Vec`) unless a borrow is the design (a view over a draft); a lifetime on a type gets a descriptive name (`'draft`, `'src`).
- Build with `let mut`, then rebind `let value = value;` when later code must not mutate it.
- Keep `Rc`, `Arc`, `Box` and `RefCell` out of shared signatures.

## 3. Types and API shape

- Naming: types and variants `UpperCamelCase` (acronyms as one word: `JsonValue`, `HttpMethod`), functions and modules `snake_case`, constants `SCREAMING_SNAKE_CASE`. No `get_` prefix (`fn name(&self) -> &str`). Conversions: `as_` free borrow, `to_` costly, `into_` consumes `self`. Constructors `new`, `try_new` (fallible), `from_x` (paired with `From` when it is a real conversion). Error types read verb-object-error (`ParseDurationError`). If you write `len()`, write `is_empty()`.
- No `bool` parameters in shared signatures: a two-variant enum or two functions. A TypeScript `flag: boolean` option becomes an enum.
- Named fields over tuples, except one-field newtypes and very local code. `Option` for absence, never a sentinel (`-1`, `""`). A data-carrying enum instead of fields that are meaningful only together.
- A TypeScript union of string literals is a fieldless enum with its text in one `as_str`; a discriminated union is an enum with data; an optional property is `Option<T>`; `T | undefined` returned from a lookup is `Option<&T>`.
- Derive what every field supports: `Debug` on every type, `Clone`, `PartialEq`/`Eq`, `Hash`, `Default` when meaningful; `Copy` only for small plain types; `PartialOrd` with `Ord` when a total order exists. A hand-written `Ord` comes with `PartialEq`, `PartialOrd` and `Hash` that compare the same fields.
- Implement `From`/`TryFrom` (never `Into`), `Display` for errors and string-like types, `FromStr` instead of an ad hoc `from_str`. Prefer `from`/`into`/`try_from` to `as`, which truncates silently.
- `#[must_use]` on pure functions whose result is the point and on types whose discard is a bug.
- Visibility: private by default, then `pub(crate)`, then `pub`. Fields private unless the struct is passive data. Each public item reachable at one path; re-export individually, never with a glob.
- Traits only for generic code or `dyn` dispatch the design asks for (a service, a half), not to organise code. Prefer concrete types, then generics, then `dyn Trait`. A function with a clear receiver is a method; one without is a free function. Closure bounds: `FnOnce`, else `FnMut`, else `Fn`; a closure parameter goes last.
- Keep parameter order consistent in a crate: call-specific first, shared context (the half context, the reporter) last.
- No macro where a function, generic or trait does the job.

## 4. Errors

- `Option` when absence is normal, `Result` when the caller must know what failed. A violated invariant is an `InternalError` returned with `?` (seampact-rust), never a panic.
- Pattern-match instead of check-then-unwrap: `let Some(value) = option else { return ... };`, `if let`, `match`. Never `is_some()` followed by an unwrap.
- Library error types implement `std::error::Error` with `Display` (lowercase, no trailing period) and `source()` for a wrapped cause, are `Send + Sync + 'static`, and convert with `From` so `?` works; `map_err` only for foreign errors or added context. One `thiserror` enum per crate (seampact-rust), not a workspace-wide one.
- Document failures: `# Errors` on every public function returning `Result`.
- A user fault is a diagnostic in the sink, not an error (seampact-rust).

## 5. Everyday idioms

- Iterators for short pipelines that read top-down (`filter`, `map`, `any`, `all`, `find_map`, `collect`); collect fallible steps into `Result<Vec<_>, _>` and apply `?`. Keep a `for` loop when the body is long, does several jobs or returns early. Prefer `for item in items` to `.for_each`. Bind a long chain to a named variable before looping on it.
- `Option`/`Result` combinators (`map`, `and_then`, `ok_or_else`, `unwrap_or`, `as_deref`) when they read better than `match`; `match` otherwise.
- `format!("{name}: {count}")` with inline arguments; `write!` into an existing `String` in a loop; no chained `+`.
- Explicit types where inference hides intent: `let names: Vec<&str> = ...collect();` rather than a turbofish on a long chain.
- Strings: never slice by byte index (`clippy::string_slice` is denied): use `char_indices`, `split_once`, `strip_prefix`, `strip_suffix`, or the UTF-16 helpers of `seampact-js` when the TypeScript counts code units.
- Collections: `get` and `get_mut`, never indexing; `entry` for insert-or-update; `Vec::with_capacity` when the size is known; `extend` over push loops.
- Imports: one `use` per module path (`use seampact_ir::{Api, Route};`); types and traits unqualified, free functions qualified by their module (`mem::take`, `fs::read`). No globs except `use super::*` in tests and `use Enum::*` inside a function that matches on it.
- A magic value becomes a named `const` with a doc line saying where it comes from.

## 6. Crates and modules

- One concept per module, named after its main item; a non-leaf module holds only `mod` lines and re-exports. Group by use case, never by kind (`types.rs`, `errors.rs`, `utils.rs`). No prelude of your own.
- Versions and lints come from the workspace; a new dependency needs the lead (seampact-rust "Dependencies").

## 7. Documentation and comments

- `///` on every public item, `//!` on the crate root and public modules. First sentence one line of about fifteen words: it is the summary in listings. Sections in order: `# Errors`, `# Panics` (none expected here).
- Document what the signature cannot say: preconditions, ownership transfer, the TypeScript quirk kept on purpose. Never restate the name (`/// Removes an element.` on `remove_element` is noise). Link items with `` [`Type`] ``.
- `//` comments say why, never what; no design journals or rule tables in code.

## 8. Tests

- Unit tests in `#[cfg(test)] mod tests { use super::*; }` for private internals; integration tests in `tests/` for the public API.
- Test behaviour and properties (round trip, idempotence, order), not restated constants or mirrored branches. A bug fix starts with a test that fails before it.
- Assertions carry context: `assert_eq!(actual, expected, "input {input:?}")`.
- A test helper returns `Result` or carries an `#[expect(clippy::unwrap_used, reason = "...")]` (seampact-rust).

## 9. Before hand-back

- `cargo fmt`, `cargo clippy -p <crate> --all-targets -- -D warnings` and `cargo nextest run -p <crate>` clean, then the gate the brief names.
- No `unwrap`, `expect` or `panic!` outside tests; no indexing or string slicing.
- No `&String`, `&Vec<T>` or `&Option<T>` parameters; no `bool` parameters in shared signatures.
- No `.clone()` whose only job is the borrow checker.
- Every public type derives `Debug` and the traits its fields allow; error types implement `Error`.
- Public items documented, with `# Errors` where they return `Result`.
- No glob imports outside tests and local enum matches; no leaked third-party types in shared signatures.
