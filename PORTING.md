# Porting rules: TypeScript to Rust (2.0.0)

The rulebook every port lane follows. What the port is and how it is checked: [the 2.0.0 Rust rewrite](docs/maintainers/rust-rewrite.md); what it changes: [ADR 0031](docs/adr/0031-rust-core.md). The first layers amend it.

The skills `seampact-rust` (how Rust is written here), `seampact-rust-practice` (general Rust practice, condensed) and `seampact-rust-port-ts` (the port procedure) apply these rules; this file is the source.

## 1. Shape of a port

- Keep the TypeScript algorithm and function shape: one Rust function per TypeScript function, same steps, same order of checks, same diagnostics. A TypeScript arrow of a few lines may stay a closure in its caller; a helper may be extracted to keep nesting at 3-4 levels. Port each JavaScript operation by its specification, not by the nearest Rust idiom (section 2).
- Redesign the data as the layer's design note says: enums with exhaustive `match` for the IR, grammar nodes and diagnostics; newtypes for ids and names; borrowed or interned strings and source spans instead of copies; traits for generators, lint rules and passes; no class hierarchy.
- Each crate keeps a `trace.tsv`: one line per function of the TypeScript files the brief names, `<rust path>\t<ts file>#<function>`. The Rust path is `<file relative to the crate>#<fn name>` (`src/load/reader.rs#read_file`); the TypeScript function is its top-level name, or `Class.member` for a class member (`Sink.#emitAt` for a private one, `Sink.constructor`). A function not ported has `-` as its Rust path and a third column, `skip: <reason>` or `merged: <rust path>`. A Rust helper with no TypeScript origin is not listed. The agent writes it; the trace check (`node scripts/rust/trace-check.ts`, a step of `cargo xtask gate`) fails on a TypeScript function missing from the file and on a Rust path that does not exist.
- State: read-only input (the loaded schemas, a bundle) is an immutable struct; memos and lazy caches are one engine state behind a `RefCell` (or `&mut self`), each borrow scoped to a block that does not call back into the engine; a recursion guard (a TypeScript `Set` filled and emptied around a recursive call) is a field of a walk context made per top-level call and passed `&mut`, never engine state.
- Identity: where the TypeScript keys a `Set`, `Map` or `WeakMap` by object identity, or compares objects with `===`, key on what that identity tells apart: a node read from an input is its (file, path) or its index in a table built at load; an object the TypeScript builds per call and never uses as a key is a plain value. An id arena only for built objects that are themselves keys.
- Access: a node handle reaches its value in constant time (a `&Value` borrowed from the loaded input, or an index into a table built at load); never walk a path or a JSON pointer from the file root on each keyword read.
- Typed input: a JavaScript `number` reads as `f64`; a member of the wrong type reads as absent where the TypeScript reads `undefined`, never as a decode failure of the whole input.
- Never port what the brief's skip list names (npm resolution, the TypeScript plugin API, Prettier glue).

## 2. Where JavaScript and Rust differ

Each row is a known trap. Use the shared helper named in the row, never a local copy; a helper not built yet is a "For the lead" item, not a reason to inline one.

| JavaScript | Rust trap | Rule |
|---|---|---|
| `a < b`, `.sort()` with no comparator, `compareCodeUnits` on strings: UTF-16 code-unit order | `str` and `String` compare bytes, which is code-point order: astral characters (surrogate pairs in JS) sort before U+E000..U+FFFF in JS, after them in Rust | every string order goes through the UTF-16 compare helper (`cmp_utf16`, and a `Utf16Key` wrapper for `BTreeMap`, `BTreeSet` and `sort_by_key`), in the `seampact-js` crate; `BTreeMap<String, _>` iterates in byte order, so never emit output from its iteration; an enum whose variants are declared in the TypeScript sort order may derive `Ord` |
| `s.length`, indices, columns: UTF-16 code units; `[...s].length`: code points | `len()` is bytes, `chars()` is scalar values | count what the TS counts: load limits, positions and columns in UTF-16 units through the text helper; JSON Schema `minLength` and `maxLength` in code points (`chars().count()`), as the example and wire checks do; spans store byte offsets and convert at the edge |
| `number`: one 64-bit float | integers and floats are distinct types | IR numbers have the TS value, except integers above 2^53 in examples and defaults, which stay exact (ADR 0031); arithmetic that JS does in floats is checked for the same result |
| `Number.isInteger(x)`; `===`, `<` on numbers | an epsilon test, `total_cmp` or `serde_json::Number` equality: `1e-17` is no integer, `0 === -0` is true | `Number.isInteger` is `x.is_finite() && x.fract() == 0.0`; `===` and comparisons on numbers are `f64` `==` and `<`; a comparison the TS makes on `number` stays an `f64` one, even on an `i64` input, unless `differences.yaml` records the change |
| `String(n)`, `JSON.stringify(n)`: ECMAScript number text (`1e+21`, `0.1`, `-0` gives `0`) | `{}` formatting differs (`1e21_f64` prints as `1000000000000000000000`) | numbers are written by the ECMAScript number-text helper only, built on `ryu-js` |
| `Object.keys`, `for...in`, `Object.entries`: array-index keys first, ascending, then insertion order | `HashMap` has no order, `BTreeMap` sorts bytes | a map that is iterated uses `IndexMap`; `serde_json` is built with `preserve_order`, once, in `[workspace.dependencies]` (feature unification turns it on for every crate), so `serde_json::Map` iterates in insertion order; where the TS iterated an object with keys like `"200"` or `"404"`, reproduce that order through one shared helper, never a local copy. Only array-index keys move first (canonical decimal, 0 to 2^32-2): `"01"`, `"-1"` and `"4294967295"` keep insertion order. The helper is `js_key_order` (iteration) and `reorder_in_js_key_order` (a map in place), in `seampact-js`; it orders one object. `JsonObject` and the IR map type apply it on every insert. Of the two writers in `seampact-json`, `canonical_json` (a comparison key, the port of `canonicalJson`) applies it to each object after the `cmp_utf16` sort, as `Object.fromEntries` rebuilt the object; `canonical_document` (the IR and source-map bytes, the port of `finalizeSerializeJson`) writes every object's members in pure `cmp_utf16` order and applies no array-index rule. |
| `Map`, `Set`: insertion order | `HashMap`, `HashSet`: random | `IndexMap` and `IndexSet` when iterated; `HashMap` only for lookups never iterated into output |
| `Array.prototype.sort`: stable | `sort_unstable` reorders equal keys | `sort_by` (stable) unless the keys are unique and the TS sort was on the same total key |
| `toLowerCase`, `toUpperCase`: full Unicode mapping, locale-free | `to_lowercase` and `to_uppercase` match JS, final sigma included; `to_ascii_lowercase` changes ASCII only | use the same mapping as the TS: the ASCII forms only where the TS input is ASCII by grammar, with a non-ASCII test otherwise |
| `RegExp`: ECMAScript flavour, `u` flag | the `regex` crate has no backreferences or lookaround, different classes | every ECMAScript pattern, contract `pattern` values and the bundled schemas' patterns included, goes through `regress`, the ECMAScript-compatible engine, tested against the pattern vectors; internal regexes are rewritten as plain code when simple; patterns the bundled schemas carry compile once at load (an invalid one is a typed environment error, not a failure mid-walk), are read from the schema keyword only (not from a property bearing the keyword's name), and a test fails when one leaves the subset where `regex` and ECMAScript `u` agree |
| `JSON.stringify` drops `undefined` members (writes `null` in arrays); a JS string can hold a lone surrogate | a Rust `String` cannot hold a lone surrogate; `serde_json::Map` sorts its keys unless `preserve_order` is on | IR and OpenAPI JSON go through the canonical writer only; how the loader treats a lone-surrogate escape is fixed in its design note |
| `Math.round(x)`: halves toward +infinity | `f64::round` rounds halves away from zero | use the rounding helper; check negative halves |
| `parseInt`, `Number(s)`: their own accepted sets (`Number("")` is `0`, `Number("Infinity")` is infinite) | `str::parse::<f64>` accepts `inf`, `NaN` and `infinity`, refuses `""` and surrounding spaces | port the accepted input set exactly, with tests on the edge strings |
| `trim`, `\s` in a regex: ECMAScript white space, U+FEFF included, U+0085 excluded | `trim` and `char::is_whitespace` use Unicode `White_Space`: U+0085 included, U+FEFF excluded | use the ECMAScript white-space helper |
| `s.replace("a", "b")` with a string pattern: the first match only | `str::replace` replaces every match | `replacen(pattern, to, 1)` |
| `s.normalize("NFC")` | no std equivalent | the `unicode-normalization` crate, NFC |
| a sort comparator that is not a total order still returns some order | `sort_by` may panic on an inconsistent comparator | write total comparators (tie-break on a unique key) |
| the `yaml` package resolves plain scalars (`yes`, `0x10`, `.inf`, `~`) by its schema | another YAML crate resolves them differently | the loader keeps the TS resolution, checked by the loader fixtures |
| `x \| 0`, `>>>`, `<<`: 32-bit integer arithmetic | 64-bit and overflow panics in debug | use `i32`/`u32` with wrapping operations where the TS relied on it |
| exceptions thrown and caught for control flow | panics are bugs | a TS `throw` caught by the caller becomes a `Result`; a TS `throw` that ended the run becomes an `InternalError` |
| `Date`, `Math.random`, environment reads in pure code | | none in the compiler and generators: output depends only on input |
| `a[i]` out of range gives `undefined` | slice and `Vec` indexing panic | `.get(i)` with `?` or `let ... else`; `clippy::indexing_slicing` and `clippy::string_slice` (`&s[a..b]`) are denied in `[workspace.lints]`, and `map[&key]` (map `Index`, which panics) is banned by review: use `.get` |
| a fallible lookup (`throw` on a bad list or role) | a stub returning a total type (`bool`) forces a made-up answer | a total answer type is never forced on a fallible operation: a fallible lookup returns `Result` |

## 3. Errors and diagnostics

- User diagnostics go to the diagnostic sink with their rule id, severity, message, fix and file position; never as `Err`.
- Environment failures (I/O, network, a bad bundle) are typed errors per crate (`thiserror`), never `Box<dyn Error>` across crates.
- A bug is an `InternalError` returned with `?`, printed by the CLI, exit 3, never a diagnostic in a sink: no `unwrap`, `expect`, `panic!`, indexing or silent fallback (a default the TypeScript does not have: `unwrap_or_default`, `unwrap_or(Ordering::Equal)`, `pop().map_or(default, ..)`) outside tests; a TypeScript `?? x` ports as `unwrap_or(x)`, and no placeholder value for a branch that cannot happen: match the shape (`[only]` slice patterns, `let ... else`) or return the `InternalError`.
- An input the TypeScript always had (a schema file of the bundle, a spec table) is a typed environment error when missing, never an empty reading.
- Messages and fixes come from the stage's message functions ([spans and diagnostics note](docs/maintainers/rust-design/spans-and-diagnostics.md), section 5); the text is part of the output the oracle compares.

## 4. The oracle loop

- Acceptance is the oracle: the expected outputs in `fixtures/expected/` (IR, diagnostics, source maps, per-half deltas), compared by the Rust harness. A difference is accepted only when exactly one entry of `fixtures/expected/differences.yaml` covers it; an entry that covers no difference is stale and fails the gate.
- Loop: build, run the touched crate's tests and the oracle on the brief's fixture subset, read the first mismatch (fixture, file, JSON pointer), fix, repeat. Never print whole IR or OpenAPI files.
- Restart rule: a module that still fails the oracle after 3 loops on the same mismatch is stopped. Commit what is green, write the mismatch and what was tried in the report, and hand back. The lead amends the brief or this file and a fresh agent ports the module again from the branch tip, after the lead's commit that deletes the failed module's files; the failed attempt is not repaired.
- A pass half starts from the expected deltas of the halves before it, reads the schema service from the recorded calls (`schema-calls/<api>.json`), and compares its own delta and diagnostics (`<NN>-<half>.diagnostics.json`); the Rust schema service is checked against the same records ([passes](docs/maintainers/rust-design/passes.md), sections 4 and 5).

## 5. No shortcuts

- Never edit an expected output, `differences.yaml` or a TypeScript source. A wrong expectation goes under "For the lead".
- No `todo!`, `unimplemented!`, `#[ignore]`, `#[allow]` without a written reason, or a test that asserts nothing. The gate refuses them.
- No special case keyed on a fixture name, path or content.
- A test is never deleted or weakened to pass.

## 6. Tests

- The fixtures, goldens and spec vectors are the main suite.
- The oracle compares each half's delta and diagnostics, and the TypeScript tests of the passes, link and validate are converted to fixtures. Port as Rust tests of the same behaviour (not copies) only what no fixture reaches: cases built on a fake service or context, the section 2 edge rows below, the stable bricks (naming, templates, the diagnostic text helpers, the IR helpers, names, paths, pointers, the draft format), and the TypeScript tests outside the passes that fixtures do not cover: finalize (collisions, prune, canonical order, serialisation, source map, reference, published packs), the load limits and positions (CPU timing tests become benchmarks).
- Read a TypeScript test only to list the behaviours it checks, then write the Rust tests.
- Each section 2 row a ported function touches gets Rust tests on its edge values (`1e-17`, `-0`, `2^53 + 1`, a non-ASCII key, an astral character), even when the TypeScript tests have none: the oracle holds only what the fixtures produce, so a green first run proves nothing about them.
- A helper function in a `tests/` crate returns `Result` or carries `#[expect(clippy::unwrap_used, reason = "...")]`: the test exemptions of `clippy.toml` cover `#[test]` functions only.
- A 2.0.0 feature that changes a behaviour gets a new test of the new behaviour.
- `proptest` on the loader and naming; `cargo-fuzz` targets on the YAML loader and the bundle reader.

## 7. Cargo and git in a lane

- Setup per worktree, nothing shared:

  ```sh
  export PATH=$HOME/.cargo/bin:$PATH
  unset CARGO_TARGET_DIR RUSTC_WRAPPER   # the target dir stays inside the worktree
  ```

- While iterating: `cargo check -p <crate> --message-format short`, then clippy and `cargo nextest run -p <crate>`. Keep output short (`-q`, short messages).
- At most 4 lanes build at once on one machine; the lead staggers cold starts.
- Git: one branch per worktree; `git add <named files>` then commit, never `git add -A` or `.`; never `git stash`, `git reset --hard`, `git checkout .`, `git clean`, `git gc`, `git worktree prune`, or deleting another lane's branch; no commit on main or develop. The lead creates and removes worktrees.
- The root `Cargo.toml` and `Cargo.lock` are shared: a lane adds only its own crate and its dependencies there, in a commit of its own named in the hand-back; the lead resolves conflicts at rebase.
- A new dependency is pinned in `[workspace.dependencies]`, named with its reason in the PR body, and passes cargo-deny. Crate docs through context7.

## 8. Gate before hand-back

On the branch rebased on `feat/rust-core`. The whole workspace runs, not only the touched crates: it stays fast (POC 4) and catches a break in another crate, an exception to the touched-tests gate of AGENTS.md. The tools are installed once per machine by the lead (`cargo install --locked cargo-nextest cargo-deny cargo-machete`).

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
cargo deny check
cargo machete
```

plus the trace check (`node scripts/rust/trace-check.ts`) and the oracle harness on every fixture (`cargo xtask oracle`). `cargo xtask gate` runs all seven from the workspace root and prints one result line per step: `<step>: ok`, `<step>: failed` or `<step>: not run: <reason>`; it exits non-zero when a step fails. Report the result line of each; a step with nothing to run yet is reported `not run: <reason>`, a tool that cannot start is `failed`, and no step is left out.

## 9. Dependencies

Versions are pinned once in `[workspace.dependencies]`. Prefer:

- `serde`, `serde_json` (`preserve_order`), `indexmap`: the parse surface and ordered maps. Whether `serde_json` gets `arbitrary_precision` is decided in the IR types design note.
- `ryu-js`: the only maintained ECMAScript number-text implementation, inside the canonical writer.
- `regress`: ECMAScript regular expressions, every pattern including the bundled schemas'.
- `clap`: the CLI. `jsonschema` with default features off (no HTTP resolver, no TLS C build): JSON Schema validation. `similar`: text diffs.
- `saphyr-parser` (events) with our own plain-scalar resolver: YAML 1.2 with spans, resolution stays ours.
- `camino`, `thiserror` (libraries), `rayon` (indexed `collect`, so output order is fixed; the `Send` and `Sync` needs are decided in each layer's design note).
- `line-index`, `text-size`: byte to UTF-16 position conversion and span newtypes.
- `unicode-normalization`: NFC; case mapping stays in `std`.
- `annotate-snippets`: diagnostic rendering. `flate2`, `tar` (>= 0.4.46; refuse absolute paths, `..` and symlinks ourselves), `sha2`: bundles.
- Tests: `insta`, `snapbox`, `libtest-mimic`, `proptest`, `criterion`, `arbitrary` with `libfuzzer-sys` in a separate `fuzz/` crate.
- `anyhow` only in the CLI binary and `xtask`.

Avoid:

- `serde_yaml` (archived), `serde_yml` (unsound), `yaml-rust`, `unsafe-libyaml`: unmaintained or unsound YAML.
- `serde_jcs`, `serde_json_canonicalizer`: wrong key order for the IR.
- `simd-json`, `sonic-rs`: unsafe-heavy speed we do not need.
- `ariadne` (archived), `miette` (imposes an error model).
- `internment`, `ustr`, `bumpalo`: supply-chain or global-state risk, or lifetimes leaking into every signature.
- `tera`, `askama`: compile-time cost for five target layouts; generators share a hand-written `CodeWriter`.
- `quickcheck`, `goldenfile`: `proptest` and `insta` cover them.
- `ring`: C build. `tower-lsp`: unmaintained. `snafu`, `eyre`: a second error idiom. `icu_*`: data weight.
