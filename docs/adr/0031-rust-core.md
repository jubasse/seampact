# ADR 0031: The 2.0.0 Rust core

Status: accepted, delivered by the 2.0.0 port

## Context

In 1.x the compiler, OpenAPI, diff, lint, bundles and the CLI are TypeScript, and the generator logic exists four times: TypeScript, PHP, Python and Kotlin. The standalone binary is a Node single executable of about 125 MB per platform, so a version weighs about 600 MB, which no longer fits Maven Central's monthly release size. The copies of the generator logic have drifted: the same fault gets a different refusal code depending on the stack.

2.0.0 rewrites the compiler and the generator half of every family in Rust, as one binary. How the port is run and checked is in [the 2.0.0 Rust rewrite](../maintainers/rust-rewrite.md). This ADR fixes what changes for users, packages and the earlier decisions. What it does not restate holds as before.

## Decision

### What stays

- The contract grammar (ADR 0002), the IR (ADRs 0004, 0005) and the config keys.
- The IR keeps its bytes: keys in UTF-16 code-unit order, numbers written as ECMAScript writes them. One exception: an integer above 2^53 in an example or a default is written exactly as the contract writes it, where 1.x rounds it. PHP, Python and Java read it exactly; a JavaScript reader rounds it on parse, as before.
- The runtime packages an app imports: `@seampact/server-runtime`, `@seampact/hooks` and the helpers on npm, the PHP, Python and Spring runtimes, and the packs (data only).
- The behaviour of the generated code. The consumer projects and the HTTP suite prove it.

### One binary, first-party generators inside

- Every first-party generator is compiled into the binary. A generator stays inert until the config names its target: it writes nothing, refuses nothing and adds no run time.
- Shared libraries and per-target WebAssembly packages are rejected: Rust has no stable ABI, each generator would ship per platform and per version, and a WASM engine costs more bytes than the generators.
- The generator trait inside the binary has the contract of the external protocol below: the IR and the target options in, files and refusals out. A generator can move out of the binary, or a community one move in, without a rewrite.

### Target ids

- A target is named by a short id, the same in every ecosystem: `use: zod`, `use: fastify`, `use: laravel`, `use: spring-boot`.
- A 1.x string (`@seampact/codegen-zod`, `pypi:seampact-fastapi`, a Maven or Composer coordinate) is refused by a diagnostic that names the short id.

### External generators

- An `exec:` entry runs a program in any language. The request (IR, options, switched-on artefacts, links, installed runtime versions) goes to its stdin as one JSON document; the response (files, warnings, refusals) comes back on stdout. The binary writes and checks the files, so `check` covers external targets too.
- The protocol ships as experimental `protocol: 1` in 2.0.0 and becomes stable in 2.1. A WASM transport over the same messages and the Rust and TypeScript SDKs come after 2.0.0.
- `defineTarget` (undocumented in 1.x) and the lint plugin API (never loadable by the CLI) are removed.
- An external generator is code the user chose to run, with the user's rights, like a build script.

### `seampact test`

The server HTTP suite is ported into the binary as `seampact test`, so a JVM, PHP or Python app runs it without Node.js. `@seampact/http-suite` is removed.

### Packages per registry

| Registry | Removed | Thinned to a launcher or runtime only | New |
|---|---|---|---|
| npm | `compiler`, `diff`, `openapi`, `lint`, `codegen-core`, the 16 `codegen-*`, `http-suite` | `cli` (launcher), `spec` (IR types and schemas) | `@seampact/cli-<os>-<arch>`, five platform packages |
| PyPI | `seampact-ir` | `seampact-codegen`, `seampact-django`, `seampact-drf`, `seampact-fastapi`, `seampact-ninja` (runtime only); `seampact-compiler` (wheels with the binary and a `seampact` command) | none |
| Maven Central | `seampact-ir`, `seampact-spring-boot` | `seampact-runner`, the Gradle and Maven plugins (launchers) | none |
| Packagist | `seampact/ir` | `seampact/codegen`, `seampact/laravel`, `seampact/symfony`, `seampact/api-platform` (runtime only) | `seampact/compiler` (launcher) |

- Removed packages are deleted at the 2.0.0 release where the registry allows it (npm within its unpublish policy, PyPI, Packagist), deprecated where npm refuses, and simply no longer published on Maven Central, which forbids deletion.
- Every Composer package keeps its read-only mirror (A19).

### Launchers

- Each ecosystem installs seampact with its own tool, as a development dependency so the lockfile pins the version: npm platform packages (as esbuild and Biome do), PyPI wheels (as ruff and uv do), Gradle and Maven plugins that fetch the platform binary (as protobuf-gradle-plugin fetches protoc), and the Composer package `seampact/compiler`. Stacks without a launcher download the binary; the config pins its version.
- A launcher holds no generation logic. It resolves the binary, checks its SHA-256, runs it and wires the result into the build (Gradle, Maven) or the framework's console (artisan, `bin/console`, `manage.py`).
- The JVM plugins fetch the binary as compressed classifiers on Maven Central, so builds behind a corporate mirror work. The real binary's size is checked against Central's monthly limit at the launcher layer.
- Launchers resolve the binary through the ecosystem's cache or mirror, for offline and corporate builds. A binary built for another platform is refused by name.
- The installed-runtime check (ADR 0025, G2) moves into the binary: it reads the installed runtime versions from the project, or the launcher passes them where only the ecosystem's interpreter can tell.

### Platforms

- The same five as 1.x: Linux x64 and arm64, macOS x64 and arm64, Windows x64. macOS keeps the ad hoc signature, Windows stays unsigned (ADR 0010, section 05).
- Linux binaries are static musl builds, one per architecture, running on glibc and Alpine alike. PyPI gets `musllinux` wheels beside the `manylinux` ones, carrying the same binary.
- Each stack guide gets a Docker section. Recommended path first: the generated code is committed and `seampact check` runs in CI, so the image needs no seampact tool, and development dependencies stay out (`npm ci --omit=dev`, `composer install --no-dev`, `uv sync --no-dev`). Then generation in the build, with a multi-stage Dockerfile where seampact stays a development dependency of the build stage.

### Bytes that change once

2.0.0 changes these outputs once, each recorded in the goldens and in the port's expected-differences file:

- The generated code's formatting, once per language family after parity: blank lines before `return`, `if`, loops, `switch`, `try` and `throw`, after a group of declarations and after a block; lines within 100 columns or the language's norm. The binary emits the blank lines itself; formatters keep blank lines but never add them.
- The OpenAPI YAML text (quoting and wrapping of the YAML emitter). OpenAPI JSON keeps its bytes.
- The gzip bytes of the bundle tarball. The integrity hash covers the file list, not the gzip stream, so existing pins keep working. Reproducibility is stated per binary version (ADR 0011).
- Diagnostic message text, now from the binary's own catalogue instead of ajv. Rule ids, pointers, severities and positions stay.
- Refusal codes: one code per fault on every stack, from one list; the troubleshooting tables are generated from it. A few codes change name.
- Integers above 2^53, as above.

### Formatting

- The binary formats TypeScript and JavaScript with oxc's formatter (the engine of oxfmt), MIT, pinned to one git revision behind one function of ours. On the five TS target goldens it gives Biome's output, differs from Prettier on 2 of 12 files, and formats 6,400 lines in about 11 ms; it adds about 2.8 MB to the binary. Biome's formatter is the fallback. Neither publishes its formatter on crates.io, hence the git pin.
- PHP, Python and Java go through one code model and one printer of ours.
- A project can run its own formatter on the generated files. A `format` list in the config maps file globs to a command, given as an argument list, never a shell string, with the files or stdin as input:

  ```yaml
  format:
    - files: ["**/*.ts", "**/*.vue"]
      command: [biome, format, --write]
    - files: ["**/*.php"]
      command: [vendor/bin/pint]
  ```

  - The first matching entry formats a file; a file no entry matches keeps the default style. The command runs from the project root, so it finds its own configuration.
  - `generate` runs it only on the files it writes, then runs it once more: a formatter whose second run changes a file is refused (`format.not-idempotent`).
  - The manifest keeps two hashes per file: the generator's output and the bytes on disk after the formatter. `check` regenerates and compares the generator's output, so it never runs the formatter and needs no formatter in CI. A hand edit is a file whose bytes differ from the second hash.
  - A missing command, a non-zero exit, a timeout or an empty or non-UTF-8 output is refused by name; nothing of that entry is written. A changed formatter command is a `check` warning: regenerate to apply it.

### Building the port

- Rust edition 2024, toolchain pinned by `rust-toolchain.toml`; the pinned toolchain is the MSRV.
- Strict from the first PR: `unsafe_code = "forbid"`, clippy `all` and `pedantic`, no `unwrap`, `expect` or `panic` outside tests, `missing_docs` on library crates, rustfmt, cargo-deny and cargo-machete.
- The Rust crates are not published in 2.0.0.
- Ready for a watch mode, a language server and framework debug panels after 2.0.0: the compiler is a library function with no global state and no exit midway, diagnostics carry a file position, the writer touches only files whose bytes change, and the set of input files is explicit.
- Each port PR keeps the docs current: what it changes in `docs/`, the READMEs, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `AGENTS.md` and the agent docs, and the cartography map. The docs site's own pages and settings change once, at the end of the port.
- A port PR covers one layer or one feature batch, about 8,000 to 15,000 lines, instead of A47's 3,000 to 4,000; the seams (workspace skeleton, diagnostics, IR and authoring types, writers) stay small and land first.

## Earlier decisions amended

Each gets a dated note now; its text is rewritten by the port PR that changes the behaviour, so the docs describe what ships.

| Decision | Change in 2.0.0 |
|---|---|
| A2, ADR 0009 | The tool installs the compiler and the first-party generators as one binary; none runs or adds a dependency to the app until its config names it. Runtime helpers stay separate packages. A community target is an external program. |
| A7, A9 | Every first-party generator runs in the binary; each ecosystem ships a thin launcher and its runtime packages. A launcher runs the binary pinned by hash; no stack needs Node.js. |
| A10, A48 | The Python packages no longer read the IR; they hold the runtime only. |
| A46 | An external generator is code the user chose to run, with the user's rights. |
| A47 | Port PR size, as above. |
| ADR 0001 | The Rust toolchain pin beside Node. |
| ADR 0006, section 4 | The lint plugin API is removed. |
| ADR 0008 | First-party packs are embedded in the binary. |
| ADR 0010 | The native IR readers and generators go (sections 01, 02, 04); the standalone binary carries the generators (05); the JVM, PHP and Python channels become launchers (08, 09, 10). |
| ADR 0011 | Tarball gzip bytes per binary version; integrity unchanged. |
| ADR 0015 | Determinism holds per binary version; no target pins its own Prettier. |
| ADR 0025 | The installed-runtime check runs in the binary. |

## Consequences

- An app's dependency tree holds no target and no runtime helper its config does not name.
- No stack needs Node.js to compile, generate, check or test.
- About 600 MB per version becomes about 60 MB (estimate), within Maven Central's monthly limit.
- 1.x configs need their `use:` ids rewritten; the refusal names each short id. Every user sees one formatting diff on the first regenerate, and `check` fails until it is committed.
- Custom TypeScript targets written against `defineTarget` move to the exec protocol.
