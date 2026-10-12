# ADR 0010: Native generators and the standalone compiler

Status: accepted

## Context

Generators outside the TypeScript ecosystem are native to their ecosystem and read the IR (amendment [A7](../decisions.md#a7)). Java users install a Gradle or Maven plugin; PHP users install Composer packages ([A15](../decisions.md#a15)). The consumer never needs Node.js: a native plugin gets the IR from a contract bundle, or, for a local YAML source, from a standalone compiler binary pinned by hash ([A9](../decisions.md#a9)). Generated Java compiles and is tested on Java 21 and 25 ([A13](../decisions.md#a13)). PHP packages live in the monorepo and reach Composer through read-only mirrors ([A19](../decisions.md#a19)). The binary ships for five platforms ([A26](../decisions.md#a26)), and the namespaces are fixed ([A27](../decisions.md#a27)).

Two risks from the framing review shape this ADR: Node single executable applications (SEA) are still experimental and need per-platform signing (devil's advocate section 8), and Composer cannot install from a monorepo subdirectory (section 5).

## Decisions

### Native generators read generated IR models

Options: hand-written Kotlin and PHP models, a general JSON Schema code generator (quicktype, jsonschema2pojo), an in-repo generator.

Choice: an in-repo generator, written in TypeScript as a tool package, reads the IR JSON Schema and writes a Kotlin model and a PHP model (FR-40). General generators were rejected: they do not let us control the three properties the IR relies on (ADR 0005), they add a large dependency, and their output changes between versions. Hand-written models drift.

Both models follow the same rules:
- Unknown fields are ignored on read, so an additive IR change does not break a reader.
- Every IR enum is open: a value class or enum wrapper with an `Unknown(raw)` case. A target that meets an unknown kind fails with a diagnostic naming the kind and the operation; it never guesses.
- Every discriminated union becomes a sealed hierarchy with an `Unknown` variant.
- Extension slots stay as raw JSON values.
- Reading checks `irVersion` against the declared range and, before 1.0, `irRevision` exactly (ADR 0005), and fails with both versions named.
- The model package ships the native naming implementation (about thirty lines, ADR 0007), tested against the shared vectors from `@seampact/spec` (FR-38).

The Kotlin model uses kotlinx.serialization (no reflection, explicit unknown-key handling). The PHP model is plain readonly classes with a generated hydrator from decoded JSON and has no dependency.

CI regenerates both models and fails on any difference, so every IR change PR updates them (FR-40). A Kotlin and a PHP reader review the IR before the frozen-for-targets gate (FR-37).

### Native artifacts

JVM, groupId `io.github.jubasse`:

| Artifact | Language | Role (ADR 0009) | Content |
|---|---|---|---|
| `seampact-ir` | Kotlin | core | IR model, naming, app-config reader (the file or the plugin DSL, [A42](../decisions.md#a42)), bundle reader and verifier, binary runner |
| `seampact-hooks` | Java | hooks | access hook interfaces and runtime types imported by generated Java, the three-state `Field<T>` (ADR 0003 section 5); no dependency; vendorable (ADR 0009) |
| `seampact-spring-boot` | Kotlin | target | the spring-boot generator, shared by both plugins |
| `seampact-gradle-plugin` | Kotlin | target | plugin id `io.github.jubasse.seampact`; task `seampactGenerate`, wired before Java compilation, with the config, the bundle or source, the binary hash and the options declared as task inputs and the output directory as its output, so up-to-date checks and the build cache work; the `seampact { }` DSL takes the app-config keys |
| `seampact-maven-plugin` | Kotlin | target | goal `generate`, bound to `generate-sources`, adds the output as a source root; `<configuration>` takes the app-config keys |

Plugin and generator bytecode targets Java 21, the lowest version A13 supports. Both plugins call the same generator library, and a golden test checks they produce identical files. `seampact-hooks` is plain Java so a Spring application does not pull the Kotlin standard library at run time.

Configuration follows each build tool's habit (A42): the app-config keys are written in `seampact.config.yaml` or in the plugin's DSL, with the same schema, never both for one app. Output goes to the app's `outDir`; a JVM app usually sets it to the build directory (`build/generated/sources/seampact/main`, `target/generated-sources/seampact`), leaves it uncommitted and sets `checks.generated` to `disabled`, while a team that reviews generated diffs keeps the default `__generated__` and commits it (ADR 0011).

Composer, vendor `seampact`:

| Package | Role | Content |
|---|---|---|
| `seampact/ir` | core | IR model, naming, app-config reader, bundle reader and verifier, binary runner, and the `vendor/bin/seampact` runner |
| `seampact/hooks` | hooks | access hook interfaces and runtime types imported by generated PHP, the three-state `Field`; no dependency; vendorable (ADR 0009) |
| `seampact/laravel` | target | a routes file or macro, controller interfaces, a FormRequest and middleware per operation (ADR 0012), the full server boundary around the developer's controller; an `artisan seampact:generate` command beside `vendor/bin/seampact` |
| `seampact/symfony` | target | a route loader, controller interfaces, the operation attribute and its `kernel.controller` listener, the input value resolver, Validator constraints, the full server boundary around the developer's controller |
| `seampact/api-platform` | target | resource metadata, DTOs, State Provider and Processor interfaces, the `kernel.controller` listener and the decorated deserialize provider; API Platform's own OpenAPI generation left as the app has it, completed with `nativeDocs` or turned off with `frameworkDocs: off` ([A43](../decisions.md#a43)) |
| `seampact/laravel-spatie` | adapter | spatie/laravel-permission behind the decide hook ([A24](../decisions.md#a24)) |

Targets are development requirements (`require-dev`); `seampact/hooks` is a runtime requirement of the application. The `vendor/bin/seampact` runner discovers installed targets through a key in each target's `composer.json` `extra` section, the PHP counterpart of the Node CLI resolving targets from the project (ADR 0009). The PHP version floor is the lowest version required by the framework majors the PHP lanes support.

### Namespaces

As A27: Maven groupId `io.github.jubasse`, Gradle plugin id `io.github.jubasse.seampact`, Composer vendor `seampact`, npm scope `@seampact`. Code namespaces follow: `io.github.jubasse.seampact.<module>` on the JVM, `Seampact\<Module>` in PHP. Generated code goes into a namespace or package the consumer chooses as a target option, never into a seampact namespace. None of these is claimed before publication ([A3](../decisions.md#a3), A27).

### How a native plugin gets the IR

- **Bundle source, the documented default.** The plugin fetches the pinned bundle (ADR 0011), verifies its integrity hash, and reads the precompiled IR. No compiler runs.
- **Local YAML source.** The plugin runs the standalone binary, pinned by hash, to compile the source to IR in a temporary directory, then reads that IR.

In both cases no Node.js installation is involved (CHK-076).

### The standalone compiler binary

Content: the compiler and every CLI command that needs no target or plugin, `init`, `compile` (with `--editor-schemas`), `check`, `lint` with the core rules, `diff`, `explain` and `bundle`, with the first-party packs embedded (ADR 0008). A Java or PHP team that owns a contract repository therefore runs its release gate (`diff` under `compat.policy: additive-only`), its lint and its editor schemas without Node.js. It carries no codegen target and no `generate`: native consumers generate with their own plugin; and lint plugins, being npm packages, stay with the Node CLI (FR-12).

Build: esbuild bundles the compiler and CLI into one file (architecture external dependency), which is wrapped as a Node single executable application on the Node version pinned by ADR 0001. One Linux job builds all five binaries by injecting the same blob into the official Node binaries of each platform, verified against the Node project's signed checksums. Code cache and startup snapshot stay off, since cross-platform builds do not support them.

Platforms (A26): linux x64 and arm64 (glibc), macOS x64 and arm64, Windows x64.

Signing:
- macOS: the injected binary is re-signed ad hoc on a macOS runner; Apple silicon refuses to run an unsigned binary. Developer ID signing and notarisation are not needed for a binary that a build plugin downloads, since no quarantine attribute is set; the spike verifies this.
- Windows: unsigned in 1.0. Authenticode signing is added if a consumer's policy requires it.

Smoke tests: on each platform's own CI runner, the binary compiles the reference contract and its IR must be byte-identical to the IR produced by the Node CLI on Linux (A26). The CLI version and the binary version are the same.

A spike runs first (devil's advocate section 8): a hello-world compiler built for the five platforms from one Linux job and smoke-run on each OS.

Fallback, if SEA proves unfit (a platform fails, startup or size is unacceptable, or a needed Node API is missing): Bun's `--compile`, which cross-compiles every platform from one host; Deno's `compile` second. To keep the fallback open, the compiler reads files only through an injected reader and uses no Node API beyond `fs`, `path` and `crypto`. The decision (one standalone binary per platform, pinned by hash) does not change with the runtime; the artifact names and the hash manifest stay the same.

Distribution and pinning:
- The binaries and a hash manifest (SHA-256 per platform) are release assets of the seampact repository.
- Each plugin release embeds a default binary version and its hashes. A consumer may override the version and hashes, the download URL (for a mirror) or a local path, always with a hash.
- The plugin verifies the hash before every first use and never runs a binary whose hash differs. Downloads are cached by hash in the ecosystem's cache directory.
- Before publication, test consumers point the plugin at a locally built binary and its hash (ADR 0011).

### PHP mirror repositories

PHP packages are developed under `php/<name>` in the monorepo (ADR 0009). A CI split job extracts each directory's history and pushes it to a read-only mirror repository, `jubasse/seampact-<name>`, with `composer.json` at its root and tags kept in step with the monorepo release (A19). The mirrors are created only before publication. Until then the job runs without pushing, and the produced trees are installed through Composer path repositories in CI to prove they are installable (CHK-088).

### API Platform spike

Before the PHP target lanes start, a spike builds one API Platform operation that serves the default format (bare payload, problem+json errors) and, with the api-platform pack, JSON-LD items, a Hydra page and Hydra errors, with API Platform's own OpenAPI generation on (its default, which A43 leaves to the app), completed by `nativeDocs`, and off through `frameworkDocs: off`. It records which API Platform mechanisms the target configures and which it keeps ([A28](../decisions.md#a28)), and in particular:

- how `security` without `object` is evaluated before the provider reads (API Platform 4.3), against the check order of ADR 0012;
- `@id` generation for a nested item whose parent id is not an item property, since the IRI converter needs every `uriVariable` from the object (`idProperty`, ADR 0002 section 6);
- the target's own reject of a restricted input field before denormalisation, since property `securityPostDenormalize` only strips ([A21](../decisions.md#a21), A42);
- validation answered as the `schemaInvalid` 400 rather than 422, with `collectDenormalizationErrors` and `allow_extra_attributes: false`;
- the JSON-LD context routes, and the documentation and entrypoint routes while API Platform's document is on, as framework routes the boot check accepts (ADR 0008, ADR 0011);
- the `kernel.controller` listener finding the operation from `_api_operation_name`, and the generated decorator of the deserialize provider running after API Platform's read and before denormalisation (ADR 0012);
- which API Platform flavours the target supports (Symfony, and whether Laravel too).

## Consequences

- A Java or PHP consumer works with no Node.js installed, from a bundle (no compiler at all) or from a local source (the pinned binary).
- Every IR change touches two generated models in the same PR; CI makes forgetting it impossible.
- Each binary release implies a plugin release that embeds its hashes. Consumers can override them without waiting.
- Linux musl (Alpine) is not a shipped binary platform; a consumer on Alpine uses the bundle path or a glibc build image.
- Every Composer package needs a mirror at publication: the six above plus the signed-webhook helper of ADR 0013, not only the three targets A19 names.

## Traceability

- FRs: FR-40, FR-38, FR-37 (version checks), FR-14 (native targets), FR-17 (standalone binary and mirrors), FR-19 (Gradle and Maven plugins), FR-21 (PHP targets), FR-13 (`diff` in the binary); amendments A7, A9, A13, A15, A19, A26, A27, A28, [A41](../decisions.md#a41), A42, A43.
- Checklist items enabled: CHK-072 (unpublished installs from Maven local and Composer path repositories), CHK-076 (no Node.js on native consumers), CHK-077 and CHK-078 (version checks and open enums in the native models), CHK-079 (Java 21 and 25 through Gradle and Maven), CHK-083, CHK-084 and CHK-085 (PHP targets), CHK-088 (mirror trees installable), and from round 4 CHK-140 (binary commands), CHK-158 (`Field`), CHK-159 (PHP decoding), CHK-166 (JVM DSL, build-directory output, artisan), CHK-167 (JSON-LD contexts).
