# The 2.0.0 Rust rewrite

For maintainers and contributors. This page covers why seampact's compiler and generators move to Rust, what the port covers, how it is checked and how work runs while it lasts. What changes for users is in the [roadmap](../roadmap.md#200-the-core-in-rust). What changes for packages, target ids and earlier decisions is fixed in [ADR 0031](../adr/0031-rust-core.md).

## Why

- **Size.** The standalone binary is a Node single executable of about 125 MB per platform, so five platforms take about 600 MB per version. Registries limit that: Maven Central caps the release size. A Rust binary is estimated at 11-14 MB per platform.
- **One language instead of five.** Today the same generator logic exists in TypeScript, PHP, Python and Kotlin, and the copies have already drifted: the same fault gives a different refusal code depending on the stack.
- **No Node.js for JVM, PHP and Python projects**, nor for the TypeScript ones to compile, generate or check.

## Scope

- **Ported to Rust:**
  - the compiler (loader, pipeline, passes, finalize);
  - OpenAPI, diff, lint, bundles and the CLI;
  - the generator half of every family (TypeScript, PHP, Python, Kotlin);
- **Stays as it is:**
  - the runtime packages each language imports (server runtime, hooks, the PHP, Python and Spring runtimes);
  - the packs, which are YAML data;
  - the consumer projects and the docs site;
  - the repository scripts that work well in TypeScript.
- **Unchanged contracts:** the contract grammar, the IR and the config keys; targets get short ids ([ADR 0031](../adr/0031-rust-core.md#target-ids)). The IR stays the same bytes: keys in UTF-16 code-unit order, numbers written as ECMAScript writes them. Only integers above 2^53 change: they are written exactly instead of rounded.
- **Public interfaces:** the IR JSON Schema, the generator protocol schema and the CLI. The Rust crates are not published in 2.0.0.

## Principles

- **Not opinionated, as before.** Every target supports every shape the contract allows. Shared Rust code never caps a stack:
  - what a target refuses is data, recording what it delivers so far;
  - a stack's own idiom stays in that stack's code.
- **Keep the algorithms, redesign the data.** The port keeps the TypeScript algorithms and the function decomposition, so each Rust function traces back to its TypeScript one through a generated map. Data, ownership and types are redesigned for Rust, as the layer's design note says (crate API, core types, ownership, errors), reviewed before its port PRs. A line-by-line copy is not the goal: the result is clean, idiomatic Rust.
- **One rulebook for every lane.** [PORTING.md](../../PORTING.md), the shared TypeScript to Rust rulebook, maps the idioms and lists where JavaScript behaves differently from Rust: numbers as 64-bit floats, string lengths and indices in UTF-16, sort stability, `Object.keys` order, `Map` order, case mapping outside ASCII, regex flavour, number text.
- **Quality bar from the first PR:**
  - `unsafe_code = forbid`, clippy `all` and `pedantic`, and no `unwrap`, `expect` or `panic` outside tests;
  - `missing_docs` on libraries, plus rustfmt, cargo-deny and cargo-machete.
- **Diagnostics are data, not errors.** Each failure falls into one of three cases:
  - user diagnostics go through a sink;
  - environment failures (I/O, network, a bad bundle) are typed errors per crate;
  - a bug is an internal diagnostic with its own exit code, never a silent fallback.
- **Ready for a watch mode and a language server.** The compiler is a library function (files in, IR and diagnostics out, no global state, no exit midway), diagnostics carry a file position, the writer touches only files whose bytes change, and the set of input files is explicit.
- **Pass ownership (ADR 0006) enforced by types.** Each pass half returns its own output and reads earlier outputs by shared reference. Writing outside ownership does not compile.

## Generators

- **Planning is shared, printing stays per family.** One crate decides what to generate:
  - the kept and refused forms, from per-target capability data;
  - the routes, with each router's syntax as data;
  - the headers, the paging and the validation rules;
  - the shared target options.

  Each family crate decides how a rule is checked in its stack (an annotation, a native argument or a runtime validator) and prints the code.
- **One refusal code per fault**, from one list. The troubleshooting tables are generated from it.
- **Generated code style.** Blank lines go before `return`, `if`, loops, `switch`, `try` and `throw`, after a group of declarations and after a block. Lines are at most 100 columns, or the language's norm. One code model and one printer serve PHP, Python and Java.
- **Your own formatter.** A project can run its own formatter on the generated files. The manifest keeps the generator's output hash beside the formatted file's, so `check` never runs the formatter and reformatting is not reported as a hand edit ([ADR 0031](../adr/0031-rust-core.md#formatting)).
- **First-party generators are compiled into the binary.** Each one stays inert until the config names its target: it writes nothing, refuses nothing and adds no run time. Shipping them as shared libraries or WebAssembly packages would save a few megabytes at the cost of an ABI, per-platform artefacts and a runtime engine.
- **One contract inside and outside.** The generator trait inside the binary has the same contract as the external protocol: the IR and the target options in, files and refusals out. A first-party generator can move out of the binary, or a community one move in, without a rewrite.
- **Custom targets.** An external generator protocol takes the IR in and gives files out, in any language, through a versioned JSON schema. Each first-party target also runs through the protocol in one test, so the protocol cannot fall behind.
- **Installed with each ecosystem's own tool.** npm platform packages, PyPI wheels, Gradle and Maven plugins that fetch the platform binary, and the Composer package. A project installs it as a development dependency, so its lockfile pins the version. A launcher holds no generation logic: it fetches the binary, checks its SHA-256, runs it and wires the output into the build (Gradle, Maven) or the framework's console (artisan, `bin/console`, `manage.py`). Linux binaries are static, so they also run on Alpine images. Stacks without a launcher download the binary, and the config pins its version.

## How the port is checked

- **The TypeScript compiler is the oracle.** `node scripts/oracle/cli.ts write` compiles every fixture and writes its expected diagnostics, IR, source map and per-half deltas under `fixtures/expected/`; `check` compares, `coverage` lists the diagnostic rules no fixture triggers ([tool README](../../scripts/oracle/README.md)). A data-driven Rust harness runs one test per fixture against them, with no Node.js in the gate. The corpus then stays as the Rust regression suite.
- **The pipeline can be dumped after each pass half**, so the halves port and check in parallel.
- **Generated code is compared token by token** (whitespace aside) during the port. The formatting change lands once per language family, after parity.
- **A refusal parity harness** compares the (code, pointer) refusals of the old generators across families, over the golden IRs.
- **Every intended difference is listed in an expected-differences file and reviewed.** These are the 1.1.1 fixes and the byte changes of [ADR 0031](../adr/0031-rust-core.md#bytes-that-change-once): formatting, OpenAPI YAML, tarball gzip, diagnostic text, unified refusal codes and integers above 2^53.
- **The fixtures, goldens and spec vectors stay the main suite.** TypeScript unit tests are ported case by case, as Rust tests of the same behaviour: tests of stable bricks, and tests that catch what the fixtures miss. A behaviour that a 2.0.0 feature changes gets a new test for the new behaviour. Runtime tests and consumer projects stay in their language.
- **The oracle is checked too.** Deliberately broken versions of the TypeScript compiler (mutation testing) show whether the fixtures catch the breakage, before the oracle becomes the acceptance test.
- **No shortcuts.** A module that fails the oracle three times is discarded and ported again from an amended brief or rule. Agents never edit expected outputs or the TypeScript sources, and the gate refuses `todo!`, `unimplemented!` and ignored tests.

## How work runs during the port

- **PRs.** Lane branches start from `feat/rust-core` and squash-merge into it once the local gate, `cargo xtask gate`, passes on the tip rebased on `feat/rust-core`. One PR per layer or feature batch, about 8,000 to 15,000 lines instead of A47's usual size ([ADR 0031](../adr/0031-rust-core.md#building-the-port)). Seams stay small and land first. A pattern review comes after the first few thousand lines of each layer PR.
- **No CI on `feat/rust-core`.** Every workflow trigger filters `main` and `develop`, so develop keeps its required checks and Dependabot while the port runs. Develop is merged into `feat/rust-core` now and then.
- **The gate is local:** `cargo xtask gate` runs the commands of [PORTING.md](../../PORTING.md) section 8, the trace check and the oracle, and prints one result line per step. At a few milestones, the lead starts one manual CI run on Linux, macOS and Windows.
- **CI is rebuilt last.** It covers the five platforms, the release dry run and new required checks, and lands on `feat/rust-core`; one PR from `feat/rust-core` to develop then runs it as the real gate, with a release dry run, and merges with a merge commit.
- **Portability from the first seam:**
  - UTF-8 paths and one validated relative-path type;
  - output paths that differ only by case or Unicode normalisation are refused;
  - `cargo check` runs for the five target triples.
- **Docs stay current through the port.** Each PR updates what it changes in `docs/`, the READMEs, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `AGENTS.md` and the agent docs, and regenerates the cartography map. The docs website is built from `docs/`; its own pages and settings are adjusted once, at the end of the port.
- **The full gate runs on the rebased tip** before each merge, not only on the lane's branch.
- **Repository scripts stay in TypeScript unless porting pays.** Scripts that ran the TypeScript compiler call the binary instead. A script moves to `cargo xtask` only when it must be rewritten anyway (the release, for cargo and the platform packages) would otherwise copy Rust types, or a measurement shows it slows CI; it then keeps its TypeScript version until the xtask one gives the same outputs.

## Order

1. **Before the first port PR:** the scope ADR (ADR 0031), the rulebook and the agents' Rust skills, a formatter spike, the oracle tooling (expected outputs, pass-half dumps, the expected-differences format), and four small proofs of concept: oracle strength, a two-agent stress test of the rulebook, model choice and restart against repair, and how many lanes build at once on one machine.
2. **Seams:** the workspace skeleton and lints, source spans and diagnostics, the IR and authoring types, the canonical JSON writer, the generator writer.
3. **Layers:**
   1. the loader and the passes, which are the critical path;
   2. OpenAPI, diff, lint, bundles and the CLI;
   3. the generator infrastructure and the planning crate, built before the second family;
   4. the generator families;
   5. the launchers per ecosystem;
   6. CI and the release.
4. **2.0.0 features**, each after its layer reaches parity.
