# Rust design: the generator infrastructure, generate and check

Layer 3.3 of the 2.0.0 port ([rust-rewrite.md](../rust-rewrite.md), "Order"): the generator contract, the target registry and short ids, the writer and its manifest version 2, the formatting of generated TypeScript, the run planning, and `seampact generate` and `seampact check`. It applies [PORTING.md](../../../PORTING.md) and reuses the shapes of the [passes](passes.md) and [cli and tools](cli-and-tools.md) notes (`NotPortedYet`, brief conventions, the oracle's tool cases). A lane uses these shapes as given; a gap goes to the lead. Evidence for the choices that depend on Rust or crate behaviour is in "Spike evidence".

Two crates are easy to confuse: `seampact-generate` (this layer) is the run planning of `generate` and `check`, what to generate for which entry and api and where to write it; `seampact-plan` is the shared per-operation planning of rust-rewrite.md "Generators" (kept and refused forms, routes, headers, paging, validation rules), designed in the 3.4 note with the first family and built before the second.

## 1. Scope

Ported in this layer:

- **The generator contract** (`codegen-core/src`): `target.ts`, `define-target.ts`, `ir-support-refusal.ts` (`refuseUnsupportedIr`), `link-check.ts`, `links.ts`, `descriptors.ts`, `framework-route-check.ts`, `import-specifier.ts`, `native-docs-document.ts`, `generate-warning.ts`, `no-options.ts`, and the per-target capability data of `spec/src/compatibility` (`matrix.json`, `python-targets.json`).
- **The target registry and short ids** of [ADR 0031](../../adr/0031-rust-core.md#target-ids). It replaces `resolve-target.ts`, which loads a package from the app's `node_modules`; nothing of that file is ported.
- **The writer**: `writer.ts`, `manifest.ts` with `"version": 2`, `file-presence.ts`, `finish-files.ts`, the writer half of `generated-paths.ts`, and the header table of the PHP, Python and Kotlin writers (section 3); the formatting of generated TypeScript and JavaScript with oxc ([ADR 0031](../../adr/0031-rust-core.md#formatting)).
- **The run planning and the two commands**: every `cli/src/commands` file the [cli and tools](cli-and-tools.md) note section 1 left for this layer but `native-entries.ts`, the 3.3 functions of `artefact-switches.ts` and `document-plan.ts`, `compatibility-check.ts`, `installed-version.ts`, `package-manager.ts`, and `runGenerate`, `runCheck`, `pluginRunOf` of `run-cli.ts`.

Waits, each refused by name:

| Left out | Where it lands | Until then |
|---|---|---|
| Every family: the 16 TypeScript targets, and the Python, PHP and Kotlin generators | layer 3.4 (section 3, "Families") | the short id answers `config.target.not-built` (section 3) |
| The family libraries `node-server/`, `front-queries/`, `validators/`, `fetch-client/` and the TypeScript helpers beside them (`planned-names`, `api-index`, `property-key`, `client-filled-headers`, `mounted-base-paths`, `query-list-wire`, `not-generated-forms`) | layer 3.4: the language-neutral parts in `seampact-plan`, the TypeScript printing in one `family-*` crate per library | not reached: no 3.3 generator calls them |
| `codegen-axios` importing `codegen-fetch` | layer 3.4: the imported pieces move into the `fetch-client` library, so no family depends on another | not reached |
| The `exec` protocol | 2.0.0 feature after parity (Order item 4) | `use: exec` answers `config.target.exec-not-available` |
| The `format` config key and the `formatter` hooks | 2.0.0 feature after parity | the key is read as today; the manifest reserves `formatter` (section 3) |
| The 100-column width and the blank-line rules of ADR 0031 "Bytes that change once" | once per family after parity, as the ADR says | the formatter keeps Prettier's settings (80 columns) |
| `seampact test` | after parity | today's `Unknown command 'test'.` |
| The native-entry hand-over: `native-entries.ts` (`npmEntryProblems`, `splitNativeEntries`, `printLeftEntries`), `run-cli.ts#nativeEntryPolicy`, `CliIo.nativeOnlyCommands`: a host that runs the Node CLI and keeps the native entries for itself | not ported, `skip:` trace lines: in 2.0.0 every generator is in the binary and a launcher holds no generation logic | a native `use` string is a 1.x name, refused by the registry lookup with its short id (`config.target.renamed`) |

## 2. Checking generate and check before the families

### The generator trait

The contract of the external protocol (IR and options in, files and refusals out), in `seampact-target`. Two traits mirror `TargetDefinition` and `Target`: a family writes the typed one; the registry and the run planning see the object-safe one through a blanket impl.

```rust
/// What a family implements: the typed half of `defineTarget`.
pub trait TargetDefinition: Sync {
    type Options;
    fn metadata(&self) -> &TargetMetadata;
    fn parse_options(&self, raw: Option<&JsonValue>) -> Result<Self::Options, TargetFailure>;
    fn generate(&self, input: &GenerateInput<'_, Self::Options>) -> Result<Generated, TargetFailure>;
    /// Only a provider overrides it; the registry test below catches one that forgets.
    fn describe(&self, _ir: &ContractIr, _options: &Self::Options) -> Result<DescriptorSet, TargetFailure> {
        Ok(DescriptorSet::default())
    }
}

/// What the registry holds and the run planning calls: the erased `Target` of `define-target.ts`.
pub trait Generator: Sync {
    fn metadata(&self) -> &TargetMetadata;
    fn generate(&self, request: &GenerateRequest<'_>) -> Result<Generated, TargetFailure>;
    fn describe(&self, ir: &ContractIr, options: &JsonValue) -> Result<DescriptorSet, TargetFailure>;
}

impl<Definition: TargetDefinition> Generator for Definition { /* define-target.ts order */ }
```

`TargetFailure` is `Refused(Refused)` or `Internal(InternalError)`, with `From` for both. A form the target cannot write is `Refused`; a state the TypeScript `throw`s on as a bug (the target's own plan already refused it) is `Internal`, never a refusal code. `seampact-generate` maps `Internal` to `GenerateError::Internal`. An `exec` generator answers refusals only; its adapter maps a malformed answer to `Internal`.

- The blanket impl runs `define-target.ts` in its order: `refuse_unsupported_ir`, `parse_options`, the link and artefact checks, the target's `generate`. The path check and the finishing (header, formatting) run after it in `seampact-generate` (`entry-generation.ts`), for every `Generator`, so an `exec` generator gets them too.
- `describe` receives the entry's options, `{}` when the entry has none (`entry-generation.ts:241` passes `options ?? {}`).
<<<<<<< HEAD
- `GenerateRequest<'run>` is `#[non_exhaustive]`, built by `GenerateRequest::new(ir)` and `with_*` setters: `ir: &'run ContractIr`, `options: Option<&'run JsonValue>`, `needs: &'run ResolvedLinkNeeds` (below), `links: &'run LinkSet`, `artefacts: &'run ArtefactSet`, `framework_routes: Option<&'run FrameworkRouteCheck>`, `hook_check: Option<HookBootCheck>`, `mount: Option<&'run str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `native_docs_document: Option<&'run NativeDocsDocument>`, `installed_runtimes: &'run InstalledRuntimes`. `GenerateInput<'run, Options>`, also `#[non_exhaustive]`, holds the same with the defaults applied and `options: Options`. Borrowed, so the TypeScript's `structuredClone`s have no counterpart. A member added later (the shared plan below) breaks no caller.
- **No output directory in the contract.** The TypeScript's `outputDirectory` has one reader, `node-server/server-runtime-check.ts:44-89`, which loads the installed `@seampact/server-runtime` version module from the output directory. Here the run planning reads each package of `TargetMetadata.runtime_packages` once per entry, from the entry's output directory upward, with `read_installed_version`, into `InstalledRuntimes` (package name to the `version` its `package.json` writes, as JSON, whatever its type; `null` when not installed or absent); the family compares data and does no file I/O, an `exec` generator never gets a host path, and the oracle compares versions ([ADR 0031](../../adr/0031-rust-core.md#external-generators): the request carries the installed runtime versions).
||||||| parent of 5a42c22d2 (Drop the stale plan-member mention from the generator request.)
- `GenerateRequest<'run>` is `#[non_exhaustive]`, built by `GenerateRequest::new(ir)` and `with_*` setters: `ir: &'run ContractIr`, `options: Option<&'run JsonValue>`, `needs: &'run ResolvedLinkNeeds` (below), `links: &'run LinkSet`, `artefacts: &'run ArtefactSet`, `framework_routes: Option<&'run FrameworkRouteCheck>`, `hook_check: Option<HookBootCheck>`, `mount: Option<&'run str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `native_docs_document: Option<&'run NativeDocsDocument>`, `installed_runtimes: &'run InstalledRuntimes`. `GenerateInput<'run, Options>`, also `#[non_exhaustive]`, holds the same with the defaults applied and `options: Options`. Borrowed, so the TypeScript's `structuredClone`s have no counterpart. A member added later (the shared plan below) breaks no caller.
- **No output directory in the contract.** The TypeScript's `outputDirectory` has one reader, `node-server/server-runtime-check.ts:44-89`, which loads the installed `@seampact/server-runtime` version module from the output directory. Here the run planning reads each package of `TargetMetadata.runtime_packages` once per entry, from the entry's output directory upward, with `read_installed_version`, into `InstalledRuntimes` (package name to `Option<String>` version, `None` when not installed); the family compares data and does no file I/O, an `exec` generator never gets a host path, and the oracle compares versions ([ADR 0031](../../adr/0031-rust-core.md#external-generators): the request carries the installed runtime versions).
=======
- `GenerateRequest<'run>` is `#[non_exhaustive]`, built by `GenerateRequest::new(ir)` and `with_*` setters: `ir: &'run ContractIr`, `options: Option<&'run JsonValue>`, `needs: &'run ResolvedLinkNeeds` (below), `links: &'run LinkSet`, `artefacts: &'run ArtefactSet`, `framework_routes: Option<&'run FrameworkRouteCheck>`, `hook_check: Option<HookBootCheck>`, `mount: Option<&'run str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `native_docs_document: Option<&'run NativeDocsDocument>`, `installed_runtimes: &'run InstalledRuntimes`. `GenerateInput<'run, Options>`, also `#[non_exhaustive]`, holds the same with the defaults applied and `options: Options`. Borrowed, so the TypeScript's `structuredClone`s have no counterpart. A member added later breaks no caller.
- **No output directory in the contract.** The TypeScript's `outputDirectory` has one reader, `node-server/server-runtime-check.ts:44-89`, which loads the installed `@seampact/server-runtime` version module from the output directory. Here the run planning reads each package of `TargetMetadata.runtime_packages` once per entry, from the entry's output directory upward, with `read_installed_version`, into `InstalledRuntimes` (package name to `Option<String>` version, `None` when not installed); the family compares data and does no file I/O, an `exec` generator never gets a host path, and the oracle compares versions ([ADR 0031](../../adr/0031-rust-core.md#external-generators): the request carries the installed runtime versions).
>>>>>>> 5a42c22d2 (Drop the stale plan-member mention from the generator request.)
- **The shared per-operation plan** (`seampact-plan`, 3.4) is called by a family from its own `generate`, with its parsed options and its links, which the plan reads ([families](families.md) section 2); the request has no plan member. Whether the `exec` protocol carries a plan is decided with `exec` after parity.
- `Generated { files: Vec<GeneratedFile>, warnings: Vec<GenerateWarning> }`; `GeneratedFile { path: String, contents: String }` (the path is checked by the writer, as the protocol's); `Refused(Vec<Refusal>)` with `Display`.
- `TargetMetadata`: `id: TargetId`, `legacy_names: &'static [&'static str]` (the 1.x `use` strings), `role: TargetRole`, `ir_support: IrSupport<'static>`, `artefacts: &'static [ArtefactDeclaration]`, `consumes: LinkNeeds`, `provides: LinkOffers`, `boot_checks: &'static [TunableBootCheck]`, `framework_docs_off_fix: Option<&'static str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `base_paths: BasePathRouting` (`Shared` or `Exclusive`), `runtime_packages: &'static [&'static str]`, `compatibility: Option<CompatibilityKey>`. The package version of the TypeScript is the binary's (`CARGO_PKG_VERSION`). Instances extend `TargetMetadata::BASE` (`..TargetMetadata::BASE`: `version` `GENERATOR_VERSION`, empty lists, `None`s); artefact ids are `ArtefactId` constants of the family table, used by the declaration and by `generate`.
- **Options.** A family's `Options` derives `Deserialize` with `deny_unknown_fields`; `parse_options` is `seampact_target::parse_options::<Options>(raw)`, which reads an absent value as `{}`, answers `options.unknown` at `/<key>` for an unknown key and `options.invalid` at the failing pointer otherwise. `NoOptions` is that function's `T = NoOptions`. No family writes its own options parser or a `serde_json::to_value` round trip; `seampact_json::from_json_value` is the one reader of a `JsonValue` into a type.
- **Refusals** are built with `Refusal::new(code, message, fix)` and its `with_member`, `with_operation`, `with_docs`; a code is a `const` of the unified list, never a literal at the site. `dyn Generator` implements `Debug` (its short id) in `seampact-target`.
- **Capability data has one source.** Seven TypeScript targets build their `consumes` styles from the matrix at load (react, vue, fastify, express, nestjs, adonis, nextjs). Here a `LinkNeed` holds `styles: NeedStyles`, `Listed(&'static [LinkStyle])` or `FromCompatibility`; the metadata holds only the `CompatibilityKey`. The run planning parses the matrix once per run (`CompatibilityMatrix::parse()` over the `include_str!` data, passed by reference, never a global or a generated `const` copy) and resolves each entry's needs into `ResolvedLinkNeeds`, which the entry-link checks and the request's `needs` read.
- `assertArtefactDeclarations` throws at load in the TypeScript; the metadata is static here, so it is a registry test over every generator, not a run-time check. A second registry test runs `describe` of every generator that provides a kind on the reference fixture's IR and requires one descriptor per provided kind (the TypeScript type forbids a provider without `describe`; here a forgotten override would only show at run time as `link.kind.not-described`).
- Every link kind, style, role and boot check is a fieldless enum with `as_str` (cli and tools section 2); `LinkNeeds` and `LinkOffers` are one `Option` field per kind, never a map.

### The stand-in: three probe generators, no family in this layer

No family is ported in 3.3. The cheapest real family is `codegen-ts` (1,363 lines plus about 100 of `codegen-core` helpers), and it reaches the provider path only; the server and consumer paths (boot checks, native docs, base-path routing, consumed links, artefacts) sit behind `node-server/` (4,307 lines, under every server: `codegen-hono` is 70 lines on top of it), `validators/` (1,498), `fetch-client/` (1,073) or `front-queries/` (1,549). Instead:

- The documents path (an app with `openapi` documents and no target entry) reaches run preparation, document planning and emission, merged documents, the writer, the manifest and drift with no generator at all.
- Three probe generators reach the entry path: links, artefacts, refusals, warnings, describe, the boot checks, native docs, import specifier styles, base-path routing, installed runtimes, the path check and the formatting. Each answers what its options say and, with `echo: true`, a `request.json` holding the request it received; a mismatch in that file points at the run planning, not at a family. Rust: crate `seampact-gen-probe`, three `static` instances of one `Probe` adapter type (as section 3 "Families"). TypeScript: three CommonJS `defineTarget` twins under `fixtures/generators/<id>/`, which the TypeScript harness links into `<root>/node_modules/` for every CLI case, so `use: probe-server` reads the same on both sides. Their `format` is Prettier 3.9.10, the version every first-party target pins, which the harness loads with `createRequire("packages/targets/codegen-ts/package.json")` and hands to the twins.

| Probe | Role | Consumes | Provides | Artefacts (`defaultOn`, `needs`) | Other metadata |
|---|---|---|---|---|---|
| `probe-server` | server | `validators` (styles `standard-schema`, `class-validator`; optional, own library `ajv`) | none | `routes` (on), `nativeDocs` (off), `hooks` (off, needs `routes`, left off without it) | boot checks `frameworkRoutes` and `hooks`; `frameworkDocsOffFix`; exclusive base paths; runtime package `probe-runtime` |
| `probe-provider` | provider | none | `validators` (`standard-schema`), `types` (`typescript`), `client` (`fetch`) | none | `describe` answers `options.descriptors`, or `options.refusals` |
| `probe-client` | client | `client` (`fetch`), `types` (`typescript`, optional, own library `probe-types`) | none | `queries` (on), `mutations` (on, needs `queries`) | import specifiers `extensionless`; `irSupport.kinds` is the full list of `seampact_ir`, and `options.unsupportedKind: true` makes it support none, so `refuse_unsupported_ir` is reached (`ir.kind.unsupported`) |

Options of every probe: `{ "files"?: [{ "path", "contents" }], "refusals"?: [Refusal], "warnings"?: [GenerateWarning], "echo"?: true, "descriptors"?: DescriptorSet }`. `request.json` is `{ "api", "operations", "links", "artefacts", "frameworkRoutes", "hookCheck", "mount", "importSpecifiers", "installedRuntimes", "nativeDocsDocument"? }`, `operations` the operation ids of the IR the entry received, `artefacts` sorted, `installedRuntimes` `{ "<package>": <version or null> }` (the TypeScript twin reads it from `node_modules/<package>/package.json` upward from its `outputDirectory`), written with `JSON.stringify(value, null, 2)` (`indented_json`).

Reached only by hand-ported tests until a family lands: the compatibility check against a real framework record, `read_installed_version` of a real framework, and the matrix-derived styles (`NeedStyles::FromCompatibility`); no probe has a matrix record. Accepted: the first family's cases reach them.

The first family is the first 3.4 lane (`codegen-ts`, for the reason above); "built before the second family" holds.

### Inert until named

`seampact-generators` builds the registry: `pub fn registry() -> Registry`, `Registry` (in `seampact-target`) a list of `&'static dyn Generator` over `static` instances. A lookup by short id is a scan; nothing runs or reads a file before it. The run planning's entry takes `registry: &Registry`, so `seampact-generate` never depends on a family and its tests run on the probes alone. `run_command` passes `seampact_generators::registry()`; `seampact_cli::oracle` passes that registry extended with `seampact_gen_probe::PROBES` (`Registry::with`). The release binary never links the probes: `seampact-gen-probe` is an optional dependency of `seampact-cli` behind its `oracle` feature, and a release-gate step runs the release binary on a config with `use: probe-server` and requires `config.target.external`.

## 3. Crates

| Crate | Directory | Holds | Depends on (beyond `ir`, `json`, `js`, `diagnostics`) |
|---|---|---|---|
| `seampact-paths` | `crates/paths` | `node_path` (`resolve`, `join`, `dirname`, `relative`, `node_modules_lookup`): the one port of Node's `path` and package lookup; `cli-config`, `bundle`, `load` import it; `RelativeOutputPath` (`try_new` refuses empty, absolute, `\`, `.` and `..` segments, empty segments, NUL; the reasons of `generated-paths.ts#unsafePathReason`), `OutputPathSet` (refuses two paths equal once case-folded, with no Unicode normalisation (ADR 0015)), `untrusted_entry_problem` (the tar and git entry rules of bundles, one reason enum each caller words), `case_folded` (moved from `seampact-target`) | `camino`, `unicode-normalization` |
| `seampact-bundle-source` | `crates/bundle-source` | `BundleSource` and its forms, `written_bundle_source` (moved from `crates/bundle/src/source.rs`) | `serde` |
| `seampact-target` | `crates/target` | today's contents; the two traits, `TargetMetadata`, `TargetId`, `TargetRole`, `ArtefactDeclaration`, `ArtefactId`, `ArtefactSet`, links, needs and descriptors, the boot-check and import-specifier types, `GenerateWarning`, `NativeDocsDocument`, `InstalledRuntimes`, `refuse_unsupported_ir`, the link check, `Registry`, the capability data (`compatibility` module: `CompatibilityMatrix::parse()` over `include_str!` of the two matrix files, `CompatibilityKey`) | `paths` |
| `seampact-format` | `crates/format` | `format_source(source, kind: SourceKind) -> Result<String, FormatSourceError>`, the one function over oxc; `SourceKind` `TypeScript` or `JavaScript`, Prettier's options and 80 columns | `oxc_formatter`, `oxc_formatter_core`, `oxc_allocator`, `oxc_span` |
| `seampact-writer` | `crates/writer` | `check_generated_paths`, `finish_files` (the extension table below), the manifest, `plan_generated_write`, `commit_generated_write`, `read_file_if_present` | `target`, `paths`, `format`, `sha2` |
| `seampact-cli-config` | `crates/cli-config` | gains `select_artefacts`, `plan_app_documents`, `plan_merged_documents` and their helpers, `check_app_compatibility`, `read_installed_version`, `find_package_manager`, `install_fix`; the typed `diff`, `lint` and `openapi` settings (lane R) and the typed generate settings (brief C1) | drops `bundle`, gains `bundle-source`, `paths` |
| `seampact-generate` | `crates/generate` | the run planning of `generate` and `check`: `prepare_run`, the app plan, entry links, entry generation, document emission, merged documents, writes, drift; moved from `seampact-cli`: `api_refs`, `contract_position`, `problem_from_refusal`, `in_app`, `app_entry_where` | `target`, `writer`, `cli-config`, `openapi`, `compiler`, `bundle-fetch`, and for the compile front below `authoring`, `bundle`, `bundle-source`, `finalize`, `load`, `pipeline`, `span` |
| `seampact-gen-probe` | `crates/gen-probe` | the `Probe` adapter and its three instances, `PROBES` | `target` |
| `seampact-generators` | `crates/generators` | `registry()`: every first-party generator | `target`, each `family-*` and `gen-*` crate |
| `seampact-cli` | `crates/cli` | gains `generate_command`, `check_command` and the flag parsing of `runGenerate`, `runCheck` | `generate`, `generators`; `gen-probe` under `oracle` |

- **The compile front sits in `seampact-generate`.** `compile_sources`, `local_bundle`, `workspace_api_names` and `source_reader` read and compile the sources of a config for every command that does (nine files of `seampact-cli` import them), not only for `generate` and `check`; they stay here until a second consumer outside the CLI needs them, and then move to a `seampact-compile-sources` crate. The `deps` step has no allow list for `seampact-generate` (it lists the generator crates only), so this adds no entry; the forbidden edge to `seampact-generators` still holds.
- **Direction, as allow lists.** The xtask gate step `deps` reads one allow list per generator crate and fails on any other `seampact-*` crate in `cargo tree -p <crate> -e normal`: a `family-<library>` crate may depend on `target`, `ir`, `json`, `js`, `naming`, `seampact-plan` and the libraries its list names; a `gen-<short id>` crate on the same plus its own family libraries. No `family-*` crate depends on a `gen-*` crate (adapters sit above libraries, so no cycle), no `gen-*` on another `gen-*`, and `seampact-generate`, `compiler`, `pipeline`, `load`, `validate`, `finalize`, `authoring`, the pass crates, `cli` and `cli-config` are absent from every list. Outside the generators, the same step checks that `seampact-generate` does not reach `seampact-generators`, `seampact-cli-config` does not reach `seampact-compiler`, and `seampact-openapi` reaches no `seampact-pass-` crate.
- **Families (3.4).** A registry entry is a `static` instance of an adapter type its family library owns, parameterised by a `&'static` framework table that holds the metadata as a field (`static HONO: NodeServer = NodeServer { framework: &HONO_FRAMEWORK }`), as the TypeScript's `nodeServerTarget({ placement, validatorStyles, frameworkDocsOffFix })` already does. A thin framework is a table row in its family library; it gets its own `crates/gen-<short id>` crate (`seampact-gen-<short id>`) only when it has code of its own. Family libraries sit flat as `crates/family-<library>` (`seampact-family-node-server`), a prefix of their own so the allow lists can tell a library from a target.
- **Short ids.** `TargetId` is the ADR's short id. The registry lists every first-party short id with its `legacy_names`, including the families 3.4 has not built: a short id with no generator yet is `config.target.not-built` ("The target '<id>' is not in this build of seampact yet.", fix "Use the 1.x CLI for this target until its family is ported."), removed when the last family lands. A 1.x first-party string is `config.target.renamed` ("'<string>' is the 1.x name of the target '<id>'.", fix "Write `use: <id>`."). Any other package string is `config.target.external` (fix: an `exec` entry). These codes join the unified refusal list.
- **`CliProblem`** stays in `seampact-cli-config`: `seampact-generate` depends on `cli-config` for the loaded configs anyway, and with the traits in `seampact-target` no crate cycles (`cli-config` reads `TargetMetadata` from `target`, `seampact-generate` reads both).
- **The writer API.** `plan_generated_write(out_dir: &Utf8Path, owner: &str, files: Vec<GeneratedFile>, policy: HandEditPolicy) -> Result<PlannedWrite, WriteStop>`; `commit_generated_write(write: PlannedWrite) -> Result<WrittenFiles, WriterError>`; `WriterError` holds `Io { path, message }` and `Internal`. `HandEditPolicy` `Refuse` or `Overwrite` (`--force`). `PlannedWrite` owns its bytes and paths and has four read accessors for the callers that report before they commit: `root_directory() -> &Utf8Path`, `files() -> impl Iterator<Item = (&str, &[u8])>` (path and final bytes), `unchanged() -> &[String]` (paths already holding these bytes) and `removable() -> &[String]` (paths an earlier write generated and this one does not). The writer offers no other entry point: the manifest serialisation and the lstat helper are internal.

  `finish_files` and `check_generated_paths` consume their files and return `Result<Vec<GeneratedFile>, Refused>`; they have no I/O and no `WriterError`. `plan_generated_write` returns `Result<PlannedWrite, WriteStop>` where `WriteStop` is `Refused(Refused)` or `Failed(WriterError)`. A function that cannot fail returns its value.
- **The extension table** of `finish_files`, the union of today's four writers (`finish-files.ts`, PHP `Write/GeneratedHeader.php`, Python `write/header.py`, Kotlin `write/GeneratedFiles.kt`), so the 3.4 families need no writer change:

  | Extension | Header | Then |
  |---|---|---|
  | `.ts`, `.tsx` | `// <header>` as the first line | `format_source` as TypeScript |
  | `.js`, `.mjs`, `.cjs` | `// <header>` as the first line | `format_source` as JavaScript |
  | `.json` | none | parsed and rewritten with `indented_json` |
  | `.php` | `// <header>` on the line after `<?php` (CRLF read as LF); a file not starting with `<?php` on a line of its own is `file.php.open-tag` | passed through (the family's printer formats) |
  | `.java`, `.kt` | `// <header>` as the first line | passed through |
  | `.py`, `.pyi`, `.toml`, `.yaml`, `.properties` | `# <header>` as the first line | passed through |
  | any other | refused, `file.extension.unsupported` naming the known extensions | |

  The header-field guard of the PHP and Python writers applies to every file: a header field (generator, version, api id) holding a control character or `?>` is `file.header.unsafe`. A file `format_source` cannot parse is `file.format.failed`. The 3.4 note checks the PHP, Python and Kotlin JSON outputs against `indented_json`'s layout.
- **The manifest, version 2** ([ADR 0031](../../adr/0031-rust-core.md#formatting)): `{ "version": 2, "owner": <entry id or "openapi">, "files": [{ "path", "source", "sha256", "formatter"? }] }`, files in UTF-16 order of path, written with `indented_json`. Without the `format` key `source` equals `sha256` and `formatter` is absent. A manifest without `version` is read as 1.x, `source` equal to `sha256`; another `version` is `writer.manifest.invalid` with the reason "it is version <n>, which this seampact does not read". `check` compares the regenerated `source` with the manifest's and reports the line (`write-drift.ts`) from the bytes on disk.
- **The generated header** is `Generated by seampact <version> (<short id>) from api "<api id>". Do not edit.`: the 1.x package and its version no longer exist.
- **The typed generate settings** (brief C1), serde forms over the validated config value in `cli-config`: `TargetEntrySettings { id, use_name (the `use` key), api, apis, document, out, link: IndexMap<String, String>, options: Option<JsonValue>, operations: Option<OperationsFilter>, artefacts: Option<ArtefactSwitches>, allow_untested: Vec<String>, mount, framework_routes: Vec<FrameworkRouteEntry>, framework_docs: Option<FrameworkDocsSwitch> }` and `AppChecksSettings { openapi: Option<CheckLevel>, generated: Option<CheckLevel>, matrix: Option<MatrixCheckLevel> }`, the members of `spec/src/config/app-config.ts#TargetEntry` and `checks-config.ts#AppChecks`; `read_app_config` reads every typed setting once (`entries: Vec<ConfiguredTargetEntry>`, `checks`, `warnings`, `openapi: Option<OpenApiSettings>` with the document placements); a value the schema passed that does not read is the one `InternalError`, at load. The accessors are infallible borrows. The raw config value stays only for diagnostic positions; no planning function, in `cli-config` or `seampact-generate`, reads a raw member or zips raw and typed entries.
- **The planned entry.** One `PlannedEntry` owns everything the run knows about an entry: settings, root, `&'static dyn Generator`, role, `ArtefactSet`, `InstalledRuntimes`, `ResolvedLinkNeeds`. Built by the app plan; later steps take `&PlannedEntry`. A TypeScript `Record<entryId, X>` becomes a field of it, never an `IndexMap<String, X>` passed beside the entries.
- **Refusal flow.** A pure check returns `Result<T, Refused>` (target, writer) or `Result<T, Problems>` (`cli-config`); a run step that also does I/O returns `Result<T, Stop>`, `Stop` `Refused(Problems)` or `Failed(GenerateError)` with `From` for both, so `?` carries refusals. No per-function "value or refusals" enum, no `match ..? { Refused(p) => return Ok(Refused(p)) }`.
- **`NotPortedYet`** as passes.md section 2 in `writer`, `cli-config` (its 3.3 functions), `seampact-generate` and `cli`; `seampact-target`, `paths`, `format`, `gen-probe` and `generators` are whole from their seam.
- **Rule ids.** `seampact-generate` and `writer` report through `Refusal` and `CliProblem` codes, no `RULE_IDS`; the new codes are listed in `seampact-target`'s unified list.

### The layer 3.2 review inputs

| Input | Place |
|---|---|
| 1 `BundleSource` out of `seampact-bundle` | seam P: `seampact-bundle-source`; `bundle`, `bundle-fetch`, `cli-config` import it, `bundle` re-exports nothing |
| 2 `CliProblem` and `problem_from_refusal` | acceptance for `CliProblem` (above); `problem_from_refusal`, `in_app`, `app_entry_where`, `names_pointer`, `contract_position`, `api_refs` move from `cli` to `seampact-generate` in seam G |
| 3 typed `diff`, `lint`, `openapi` settings | lane R: serde forms over the validated config value in `cli-config`, as `bundle_source.rs`; `LoadedAppConfig` exposes them, `cli` stops reading raw members. The generate settings are brief C1's (above) |
| 4 the validated relative path and the untrusted-entry validator | seam P: `seampact-paths`; lane R moves the seven sites onto it (`compile_command.rs:153`, `init_command.rs:204`, `write_editor_schemas.rs:29`, `bundle/src/write.rs:95`, `cache.rs:174`, `git_tree.rs:89`, `tarball_read.rs:140`) |
| 5 derivation ids in `seampact-ir` (m17) | lane R, by a one-shot script (move map, dry run on a throwaway clone): one `derivation_ids` module of `pub const DerivationId`s, one per row of `compiler/src/derivations/table.ts` the Rust uses, and the 103 sites in 43 files import them; `openapi` drops `pass-access-identity` and `pass-derive-wire`. The IR crate is lead-owned: the lead approves the module (constants only, no IR format change) |
| 6 `refuseUnsupportedIr` | seam G, `seampact-target` |
| 7 one oracle JSON builder module (M6) | seam P: `crates/cli/src/oracle/json.rs`, before seam G adds the generate subjects |
| 8 IR-to-JSON round trips | acceptance: `check` runs no contract diff (`write-drift.ts` compares file lines), so no round trip is on the path; brief L1 measures `generate` and `check` on `fixtures/scale` and confirms with `rg` that `seampact-generate` calls neither `json_of` nor `to_json_value` |
| 9 consumers and `not_ported.rs` | brief L1 (section 8) |
| 10 public surfaces (m15) | lane R: `bundle`, `bundle-fetch` and `openapi` export the entry functions of cli and tools section 5, the types in their signatures and what `seampact-generate` calls (`emit_documents`, `merge_documents`, `parse_emitter_options`, `fetch_bundle`); the rest is `pub(crate)`, tested through the entry points |
| 11 the diff report through `diagnostic_inert` | does not apply: `generate` and `check` build no diff report; a baseline from a bundle or a git ref is a `diff` command change outside this layer |

## 4. Third-party crates

| Need | Decision | Settled by |
|---|---|---|
| Formatting generated TypeScript and JavaScript | `oxc_formatter` 0.78.0, `oxc_formatter_core`, `oxc_allocator`, `oxc_span` (0.158.0), all from one git rev (tag `oxfmt_v0.78.0`, rev `7d8e1f49`), each with `version` beside `rev` (cargo-deny refuses a git dependency without one as a wildcard); `deny.toml` allows the oxc repository under `allow-git` and lifts the `icu_segmenter` ban for the wrapper `textwrap` only (oxc_diagnostics reaches it) | spike: 10 of 12 goldens byte-identical to Prettier at 80 columns, the 2 others differ in tokens; `cargo deny`: licences and sources pass once the git source is allowed |
| Formatting generated JSON | none: parsed and rewritten with `seampact_json::indented_json` (`JSON.stringify(value, null, 2)`, Prettier's JSON output for the generators' values) | spike: oxc's `SourceType` refuses `.json` |
| Manifest hashing | `sha2` (pinned) | the TypeScript |
| Reading installed versions and the package manager | none: `installed-version.ts` and `package-manager.ts` read `package.json` files and lockfile names; no process is spawned in this layer | the TypeScript |
| Spawning (`exec`, `format`) | none in 3.3; the 2.0.0 features decide (`std::process::Command` with an argument list, as `fetch-git`) | out of scope |

- oxc adds 25 `oxc_*` crates, `num-bigint` 0.5 beside `jsonschema`'s 0.4, `syn` 3 beside 2 (build only) and the `icu_*` segmenter data. The earlier formatter spike measured +2.76 MB at another configuration; seam G records the release size delta of the static musl binary at this rev, `icu_segmenter` data included, and runs the cross-build matrix (the five triples) once. `multiple-versions` stays `warn`.
- The pin moves only in a lead PR that reruns the oracle; `oxc_formatter`'s API promises nothing.

## 5. The oracle extension

Before any port lane. Seam T (TypeScript) starts in wave 0, seam G (Rust) in wave 1; `scripts/oracle/README.md` documents the final layout and wins over this section.

### Cases

- `generate` and `check` cases are CLI cases (`fixtures/cli/<case>/`, `--tool cli`). `cli.json` gains a second form: `{ "steps": [ { "argv": [string], "cwd"? } | { "write": { "<path under tree/>": "<text>" } } | { "remove": ["<path>"] } ], "env"? }`, run in order on one root. Each side runs its own `generate` before a `check`, so a check case never reads files the other side wrote (their formatting and manifests differ by design).
- Expected: `cli/<NN>-transcript.json` per `argv` step (`NN` from `01`), same shape as `cli/transcript.json`; a one-`argv` case keeps `cli/transcript.json`.
- The probes' TypeScript twins live in `fixtures/generators/probe-*/`, linked into every CLI root's `node_modules/`; the oracle's Rust registry has them (section 2).
- Corpus: hand-written cases for the documents path (one app, a root with apps and merged documents, every `checks.openapi` and `checks.generated` level, a hand edit, `--force`, a manifest owned by another entry, a removed file), the 1.x upgrade case (below), and the CLI tests converted by hand to probe cases (`check-command.test.ts`, `generate-refusals.test.ts`, `native-docs.test.ts`, `filter-operations.test.ts`, `exclusive-base-paths.test.ts`, `import-specifier-styles.test.ts`): their fakes map onto the probes' options. `artefact-switches.test.ts` and `document-plan.test.ts` add recorded `cli-config` calls (`selectArtefacts`, `planAppDocuments`, `planMergedDocuments`) under those cases.
- **The 1.x upgrade case**: a `steps` case whose `tree/` holds a fixed 1.x manifest (no `version`) and the files it lists, their bytes matching its hashes; `generate` without `--force` must rewrite them on both sides with no hand-edit refusal.
- Hand-ported (no case reaches them in 3.3): `compatibility-check.test.ts`, `installed-version.test.ts` (real framework records need a family), malformed manifests, the writer's refusals on a symbolic link and a path leaving its root, the header and extension cases of `php/ir/tests/Write/GeneratedWriterTest.php`, `python/ir/tests/test_generated_writer.py` and `jvm/seampact-ir/src/test/kotlin/.../write/GeneratedWriterTest.kt`, `RelativeOutputPath` and `OutputPathSet`, `format_source` on the goldens.
- A behaviour a converted case or a recorded `cli-config` call reaches gets no hand test; briefs delete such tests in the crates they touch (`cli-config` `document_plan`, `artefact_switches`; `generate` `filter_operations`; the writer's write-cycle tests).

### Comparison on the Rust side

- A written file under a directory holding a written `.seampact-manifest.json` is generated output:
  - `.ts .tsx .js .mjs .cjs .json`: output `generated`, compared as token streams with whitespace aside (string, template and comment contents kept whole). Before the compare, both sides get the same normalisations: the first line's header becomes `// Generated by <generator> (<short id>) from api "<api id>". Do not edit.`, the TypeScript package name mapped to its short id through the registry's `legacy_names` (a probe's package name is its id), so the short id and the api id are still compared; in `.ts` and `.tsx`, a `,` right before the `>` that closes a type-parameter list is dropped, and the leading `|` of a union type broken over lines is dropped (the spike's two formatter rewrites). One mismatch is one file. Any other formatter difference needs a `differences.yaml` entry with `output: generated`, a literal `path` (no glob) and `from` and `to` holding the differing token text, which accepts only that hunk; seam T makes the schema refuse a `generated` entry without them, and `change: format` is no longer used for whole files.
  - `.seampact-manifest.json`, output `cli-files`: the Rust manifest must be version 2 and each `source` and `sha256` must equal the SHA-256, computed by the oracle with `sha2` (never the writer's helper), of that file's bytes in the tree snapshot taken right after the Rust `argv` step that last wrote this manifest; a file a later `write` or `remove` step changed is compared against that snapshot, not the tree at the end. Then `owner` and the ordered `path` list compare by value with the TypeScript manifest, and for each file whose written bytes are equal on both sides, the two `sha256` values must be equal too. The manifest version and the hashes change once by this normalisation, not by `differences.yaml` entries.
  - `.yaml` and `.json` OpenAPI documents in a directory owned by `openapi`: as `openapi` (parsed YAML, JSON bytes), cli and tools section 4.
- The Rust version string in written texts and streams is replaced by `<version>` before the comparison, as the run root by `<root>`.
- Every other comparison is cli and tools section 4's. `differences.schema.json` needs no new output: `generated` exists; seam G implements its comparison (`OutputKind::Generated` is "not compared yet" today).
- Native `use` strings: the TypeScript says `config.target.native`, the Rust `config.target.renamed`: one `code-renamed` entry per case, recorded by the lead.

## 6. Seam PRs and the refactor lane

Seam P and seam T start together in wave 0 and share no file: seam T owns `scripts/oracle`, `scripts/rust` and `fixtures/`; seam P, lane R and seam G own `crates/`, `Cargo.toml`, `deny.toml` and `xtask`.

### Seam P: what seam G needs (`gen-prep`, N5)

`seampact-paths` (whole, with its tests), `seampact-bundle-source` (the move, `cli-config` and `bundle-fetch` switched to it), and `crates/cli/src/oracle/json.rs`. Behaviour does not change: the whole oracle matches before and after. It freezes `RelativeOutputPath`, hence N5; it is small and ports no TypeScript body.

### Lane R: the 3.2 refactors (`gen-refactor`, N3)

After seam P, beside seam G (wave 1). Inputs 3, 4 (the seven sites), 5 (the derivation ids, by script) and 10 of section 3. Behaviour does not change; it ports no TypeScript body. It touches the pass crates, `openapi`, `bundle`, `bundle-fetch`, `editor-schemas`, `cli-config` and `cli`; seam G touches `cli` only in `run_cli.rs`, `lib.rs` and `oracle/`, and `cli-config` only in new modules, so the two rebase on each other without conflict on a shared line; seam G merges first.

### Seam T: the TypeScript oracle extension (`gen-oracle`, N3)

The `steps` form of `cli.json`, the probe twins and their linking, the cases and converted tests of section 5, the recorded `cli-config` calls, the `generated` entry rule of `differences.schema.json` (literal `path`, `from` and `to` required), the README section (first commit), and in `scripts/rust`: `trace.ts` reads the tables of `GENERATOR_TABLES_DIR` beside `TOOL_TABLES_DIR` (a crate may have a table in both), then a rerun of `generator-coverage.ts`, which recuts the briefs of section 8 from the cases' pairs.

### Seam G: the generator skeleton (`gen-seam`, N5)

After seam P; merges after seam T, rebased, with every generate and check case `NotPorted` or matching.

- Crates `format`, `writer`, `generate`, `gen-probe`, `generators` (`Cargo.toml`, `lib.rs`, empty `trace.tsv`, `src/not_ported.rs` and the `allow` where stubs remain), the moves of input 2.
- Whole: the `seampact-target` contract of section 2 (the function lines of `target.tsv` and the capability data), `format_source`, the probes, the registry and its two tests.
- Stubs with the TypeScript's parameters: `seampact-writer` (every function of `writer.tsv`), the 3.3 functions of `cli-config.tsv`, `seampact-generate` (`prepare_run`, `committable_writes`, `commit_writes`, `find_write_drift` and every function of `generate.tsv`), `generate_command` and `check_command`. `run_generate` and `run_check` parse their flags (`runGenerate`, `runCheck` and `pluginRunOf` are ported whole here: their rows are the `skip:` lines of `cli`'s trace from layer 3.2, which seam G turns into ported lines; usage errors keep their text) and call the stubs, replacing the `cli.not-ported` arm; `nativeEntryPolicy` gets its `skip:` line (section 1).
- The Rust oracle: the `steps` reader, the `generated` token compare and its normalisations, the version and manifest normalisation; `crates/cli/src/oracle/` wires the generate cases through the registry with the probes (section 2).
- `Cargo.toml`: the new crates, the oxc pins; `deny.toml`: `allow-git` and the `icu_segmenter` wrapper; xtask gate: the `deps` step with the allow lists of section 3, and the release-gate step of section 2 (`use: probe-server` refused by the release binary); the musl size delta and the cross-build matrix of section 4, recorded in the PR.
- The unified refusal list gains `config.target.renamed`, `config.target.external`, `config.target.not-built`, `config.target.exec-not-available`.

A seam that freezes a type runs at N5 (Opus, effort high), about twice a port lane's N2 (Sonnet medium) per line; seams G and P hold types, signatures and the contract's bodies only, lane R is a refactor at N3, and every other body goes to an N2 brief.

## 7. Coverage tables

- `scripts/rust/generator-coverage.ts` writes one TSV per crate in `docs/maintainers/rust-design/generators/` (`paths`, `target`, `writer`, `cli-config`, `generate`, `cli`; the columns of passes.md section 6). It reuses `toolUnitsOf` and `toolSourceFileOf` of `tools-coverage.ts`, `cutBriefs`, `coverageTable`, `pairsOf` and `CoverageProbe` of `pass-coverage.ts`, and the CLI pairs of `tools-pairs.ts`: a generate or check case is a CLI case.
- Rerun: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/generator-coverage.ts`.
- Seam T's rerun cut the briefs from the cases' pairs (74 CLI cases run `generate` or `check`); the TSV is authoritative over the tables below.
- The `writer` table lists the TypeScript writer only; W1 also ports the header table of the three other writers (about 70 lines across `GeneratedHeader.php`, `header.py` and `GeneratedFiles.kt`), as new code: those files are not TypeScript and have no trace rows.

| Crate | Function lines | Skeleton (Rust lines, estimate) | Briefs | Lines per brief |
|---|---|---|---|---|
| `paths` | 17 (plus the bundle entry rules moved in) | 15 | in seam P | 17 |
| `target` | 446 (plus the matrix data) | 525 | in seam G | 446 |
| `writer` | 488 (plus about 70 of the other writers' header tables) | 450 | 1 | about 560 |
| `cli-config` | 878 | 840 | 1 | 878 |
| `generate` | 1,530 | 1,170 | 2 | 962 568 |
| `cli` | 53 | 30 | 1 | 53 |

## 8. Briefs

Cut rule and conventions: passes.md section 7 and cli and tools section 7 ("Brief conventions"). A brief names its functions by `rg '^<n>\t' docs/maintainers/rust-design/generators/<crate>.tsv`, in the "files under" and "name file.ts:a-b" shape of the context packs, the oracle command `cargo xtask oracle --tool cli '<glob>'` and the TypeScript test files of its files ("ledger from the converted cases"; hand-ported only what section 5 lists).

| Brief | Crate | Files (TypeScript, `rg '^<n>\t'` of the TSV) | Reached by |
|---|---|---|---|
| W1 | `writer` | `codegen-core/src`: `file-presence`, `generated-paths` (but `unsafePathReason`, `caseFolded`), `manifest`, `writer`, `finish-files`; the extension table of section 3, with its tests hand-ported from the PHP, Python and Kotlin writers | every case that writes; the documents cases first |
| C1 | `cli-config` | `cli/src/config`: the rest of `document-plan` and `artefact-switches`, `package-manager`, `installed-version`, `compatibility-check`; the typed generate settings of section 3 | documents cases (`planAppDocuments`), probe cases (`selectArtefacts`); hand-ported tests for the last three files |
| RP1 | `generate` 1 | `cli/src/commands`: `drift-level`, `run-preparation`, `app-plan`, `document-emission`, `filter-operations`, `entry-links`, and the rows of brief 1 of `write-plan`, `entry-generation`, `exclusive-base-paths`, `framework-docs`, `framework-route-check`, `import-specifier-styles` | the 19 cases that reach only brief 1's functions |
| RP2 | `generate` 2 | `merged-documents`, `write-drift`, `link-set`, `native-docs-document`, and the rows of brief 2 of `write-plan`, `entry-generation`, `exclusive-base-paths`, `import-specifier-styles`; the installed runtimes and `ResolvedLinkNeeds` of section 2 | the other cases: merged documents, `check`, every generating probe |
| L1 | `cli` | `generate-command`, `check-command`; the end of the layer below | every generate and check case |

L1 also ends the layer's stubs: it deletes `crates/cli/src/not_ported.rs`, `CliError::NotPortedYet`, the `StubError` impls and `stub_answer.rs` once no crate has a `NotPortedYet`, and the `expect(dead_code)` items of `cli_problem.rs` and `lib.rs` that moved to `seampact-generate` or now have callers (`read_workspace_configs`, `read_run_config`, `api_refs`, `contract_position`); it runs the measurement of input 8 and records it in its hand-back. End check: `rg 'NotPortedYet|not_ported|not-ported|StubError|allow\(dead_code|expect\(dead_code|pending:' crates/{cli,cli-config,generate,writer}` prints nothing, and `cargo xtask oracle --tool cli` reports 0 not ported.

In RP2 and L1: applies section 3 'Refusal flow', 'The planned entry' and the stored typed settings to `generate` and the 3.3 modules of `cli-config` before porting new rows. If they land in a refactor PR before RP2, that one PR is cheaper than reworking RP2.

Five briefs over four units, plus the contract in seam G, the paths in seam P and the refactors in lane R.

## 9. Wave plan

At most four cargo lanes at once; one PR per brief; port lanes N2.

- **Wave 0**: seam P (N5, cargo) and seam T (N3, TypeScript) in parallel.
- **Wave 1**: seam G (N5) and lane R (N3), both after seam P; seam T goes on. Seam G merges after seam T, lane R after seam G.
- **Wave 2**: W1, C1 and RP1 in parallel. An Opus pattern review after the first merged brief that ports bodies (W1 or C1); its findings amend this note before RP2.
- **Wave 3**: RP2 (after RP1), then L1 (after every other brief).
- **Layer review** at the end, then the 3.4 note before the first family lane.
- A lane rebases on `feat/rust-core` between briefs and reruns the whole oracle.

### What the 3.4 note decides

Decided in the [families](families.md) note.

## 10. PORTING.md and docs

- PORTING.md section 4: the `steps` cases and the `generated` comparison (this PR). Section 9: the oxc crates by git rev, and `icu_segmenter` allowed only through `textwrap` (this PR).
- [cli and tools](cli-and-tools.md) section 1: the waiting rows now point here; `exec` and `format` are 2.0.0 features after parity, not layer 3.3 (this PR).
- [rust-rewrite.md](../rust-rewrite.md) "Generators": the shared planning of that section is `seampact-plan`, designed in the 3.4 note and built before the second family; `seampact-generate` here is the run planning (this PR).
- [ADR 0031](../../adr/0031-rust-core.md) "Bytes that change once": the generated header's generator name and version, and the new `config.target.*` codes, belong to its list (lead change, section 3).
- `scripts/oracle/README.md` (seam T), `crates/oracle/README.md` (seam G).

## Spike evidence

A scratch cargo project on the repository toolchain (1.99.1) with `oxc_formatter` at tag `oxfmt_v0.78.0` (rev `7d8e1f49`) and path dependencies on `seampact-openapi` and `seampact-cli`, the repository's `Cargo.lock` and `deny.toml`; deleted after the note.

| Check | Result |
|---|---|
| Release build | 2 min 16 s cold for oxc and the two seampact crates |
| `format` at 80 columns, default options, over the 12 TypeScript goldens of `packages/targets/*/golden` (6,377 lines, Prettier output) | 10 identical; `vue/tanstack/queries.ts` 4 lines (a long union printed with a leading `\|` per member), `vue/tanstack/composables.ts` 34 lines (`<OnMutateResult = unknown,>` printed `<OnMutateResult = unknown>`): token differences, not whitespace |
| A `.json` file | `SourceType::from_path` refuses the extension: oxc formats JavaScript and TypeScript only |
| `cargo deny check` with `allow-git` for the oxc repository | advisories, licences and sources pass; bans fail on `icu_segmenter` 2.4.0 (banned by name), reached through `textwrap` 0.16.4 from `oxc_diagnostics`; git dependencies without a `version` are wildcards |
| `cargo tree -d` | from oxc: `num-bigint` 0.5.1 (beside 0.4.8 from `jsonschema`), `syn` 3.0.10 (beside 2, through `displaydoc` for `icu_*`); 25 `oxc_*` crates and 17 `icu_*`, `zerovec`, `yoke` and sibling crates |
