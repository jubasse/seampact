# Porting rules: TypeScript to Rust (2.0.0)

The rulebook every port lane follows. What the port is and how it is checked: [the 2.0.0 Rust rewrite](docs/maintainers/rust-rewrite.md); what it changes: [ADR 0031](docs/adr/0031-rust-core.md). Version 0: POCs and the first layers amend it.

The skills `seampact-rust` (how Rust is written here) and `seampact-rust-port-ts` (the port procedure) apply these rules; this file is the source.

## 1. Shape of a port

- Keep the TypeScript algorithm and its function decomposition: one Rust function per TypeScript function, same steps, same order of checks, same diagnostics.
- Redesign the data as the layer's design note says: enums with exhaustive `match` for the IR, grammar nodes and diagnostics; newtypes for ids and names; borrowed or interned strings and source spans instead of copies; traits for generators, lint rules and passes; no class hierarchy.
- Each crate keeps a `trace.tsv`: one line per ported function, `<rust path>\t<ts file>#<function>`. A Rust function with no TypeScript origin (a helper the redesign needs) is not listed.
- Never port what the brief's skip list names (npm resolution, the TypeScript plugin API, Prettier glue).

## 2. Where JavaScript and Rust differ

Each row is a known trap. Use the shared helper named in the row, never a local copy; a helper not built yet is a "For the lead" item, not a reason to inline one.

| JavaScript | Rust trap | Rule |
|---|---|---|
| `a < b`, `.sort()` with no comparator, `compareCodeUnits` on strings: UTF-16 code-unit order | `str` and `String` compare bytes, which is code-point order: astral characters (surrogate pairs in JS) sort before U+E000..U+FFFF in JS, after them in Rust | every string order goes through the UTF-16 compare helper; `BTreeMap<String, _>` iterates in byte order, so never emit output from its iteration |
| `s.length`, indices, columns: UTF-16 code units | `len()` is bytes, `chars()` is scalar values | limits, positions and columns count UTF-16 units through the text helper; spans store byte offsets and convert at the edge |
| `number`: one 64-bit float | integers and floats are distinct types | IR numbers keep the source text's value; integers above 2^53 stay exact (ADR 0031); arithmetic that JS does in floats is checked for the same result |
| `String(n)`, `JSON.stringify(n)`: ECMAScript number text (`1e+21`, `0.1`, `-0` gives `0`) | `{}` formatting differs (`1e21_f64` prints as `1000000000000000000000`) | numbers are written by the ECMAScript number-text helper only |
| `Object.keys`, `for...in`, `Object.entries`: integer-like keys first, ascending, then insertion order | `HashMap` has no order, `BTreeMap` sorts bytes | a map that is iterated uses `IndexMap`; where the TS iterated an object with keys like `"200"` or `"404"`, reproduce the integer-first order explicitly |
| `Map`, `Set`: insertion order | `HashMap`, `HashSet`: random | `IndexMap` and `IndexSet` when iterated; `HashMap` only for lookups never iterated into output |
| `Array.prototype.sort`: stable | `sort_unstable` reorders equal keys | `sort_by` (stable) unless the keys are unique and the TS sort was on the same total key |
| `toLowerCase`, `toUpperCase`: full Unicode mapping, locale-free | `to_lowercase` matches outside ASCII except a few context-sensitive cases; `to_ascii_lowercase` is ASCII only | names and wire forms that the grammar limits to ASCII use the ASCII forms; any other text uses `to_lowercase` and a non-ASCII test |
| `RegExp`: ECMAScript flavour, `u` flag | the `regex` crate has no backreferences or lookaround, different classes | contract `pattern` values use the ECMAScript-compatible engine the seam picks, tested against the pattern vectors; internal regexes are rewritten as plain code when simple |
| `JSON.stringify` drops `undefined`, writes `NaN` as `null`, escapes as ECMAScript does | `serde_json` refuses NaN, escapes differently | IR and OpenAPI JSON go through the canonical writer only |
| `Math.round(x)`: halves toward +infinity | `f64::round` rounds halves away from zero | use the rounding helper; check negative halves |
| `parseInt`, `Number(s)`: lenient parsing | `str::parse` is strict | port the accepted input set exactly, with tests on the edge strings the TS accepted |
| `x \| 0`, `>>>`, `<<`: 32-bit integer arithmetic | 64-bit and overflow panics in debug | use `i32`/`u32` with wrapping operations where the TS relied on it |
| exceptions thrown and caught for control flow | panics are bugs | a TS `throw` caught by the caller becomes a `Result`; a TS `throw` that ended the run becomes an internal diagnostic |
| `Date`, `Math.random`, environment reads in pure code | | none in the compiler and generators: output depends only on input |

## 3. Errors and diagnostics

- User diagnostics go to the diagnostic sink with their rule id, severity, message, fix and file position; never as `Err`.
- Environment failures (I/O, network, a bad bundle) are typed errors per crate (`thiserror`), never `Box<dyn Error>` across crates.
- A bug is an internal diagnostic with its own exit code: no `unwrap`, `expect`, `panic!` or silent fallback outside tests.
- Messages and fixes come from the rule catalogue; the text is part of the output the oracle compares.

## 4. The oracle loop

- Acceptance is the oracle: the expected outputs in `fixtures/expected/` (IR, diagnostics, source maps, per-half deltas), compared by the Rust harness. A difference is accepted only when an entry of `fixtures/expected/differences.yaml` covers it.
- Loop: build, run the touched crate's tests and the oracle on the brief's fixture subset, read the first mismatch (fixture, file, JSON pointer), fix, repeat. Never print whole IR or OpenAPI files.
- Restart rule: a module that still fails the oracle after 3 loops on the same mismatch is stopped. Commit what is green, write the mismatch and what was tried in the report, and hand back. The lead amends the brief or this file and a fresh agent ports the module again; the failed attempt is not repaired.
- A pass half starts from the expected delta of the half before it and compares its own delta.

## 5. No shortcuts

- Never edit an expected output, `differences.yaml` or a TypeScript source. A wrong expectation goes under "For the lead".
- No `todo!`, `unimplemented!`, `#[ignore]`, `#[allow]` without a written reason, or a test that asserts nothing. The gate refuses them.
- No special case keyed on a fixture name, path or content.
- A test is never deleted or weakened to pass.

## 6. Tests

- The fixtures, goldens and spec vectors are the main suite.
- Port as Rust tests of the same behaviour (not copies) the TypeScript tests that fixtures do not cover: finalize (collisions, prune, canonical order, serialisation, source map, reference, published packs), link relays, derive errors and wire diagnostics, access diagnostics, the load limits and positions (CPU timing tests become benchmarks), validate diagnostics. Tree and pipeline: only their stable bricks (names, paths, pointers, the draft format).
- Read a TypeScript test only to list the behaviours it checks, then write the Rust tests.
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
- A new dependency is pinned in the workspace `Cargo.toml`, named with its reason in the PR body, and passes cargo-deny. Crate docs through context7.

## 8. Gate before hand-back

On the branch rebased on develop:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
cargo deny check
cargo machete
```

plus the oracle harness on every fixture. Report the result line of each.
