# Rust design: the generator infrastructure, generate and check

Layer 3.3 of the 2.0.0 port ([rust-rewrite.md](../rust-rewrite.md), "Order"): the generator contract, the target registry and short ids, the writer and its manifest version 2, the formatting of generated TypeScript, the run planning, and `seampact generate` and `seampact check`. It applies [PORTING.md](../../../PORTING.md) and reuses the shapes of the [passes](passes.md) and [cli and tools](cli-and-tools.md) notes (`NotPortedYet`, brief conventions, the oracle's tool cases). A lane uses these shapes as given; a gap goes to the lead. Evidence for the choices that depend on Rust or crate behaviour is in "Spike evidence".

## 1. Scope

Ported in this layer:

- **The generator contract** (`codegen-core/src`): `target.ts`, `define-target.ts`, `ir-support-refusal.ts` (`refuseUnsupportedIr`), `link-check.ts`, `links.ts`, `descriptors.ts`, `framework-route-check.ts`, `import-specifier.ts`, `native-docs-document.ts`, `generate-warning.ts`, `no-options.ts`, and the per-target capability data of `spec/src/compatibility` (`matrix.json`, `python-targets.json`).
- **The target registry and short ids** of [ADR 0031](../../adr/0031-rust-core.md#target-ids). It replaces `resolve-target.ts`, which loads a package from the app's `node_modules`; nothing of that file is ported.
- **The writer**: `writer.ts`, `manifest.ts` with `"version": 2`, `file-presence.ts`, `finish-files.ts`, the writer half of `generated-paths.ts`; the formatting of generated TypeScript and JavaScript with oxc ([ADR 0031](../../adr/0031-rust-core.md#formatting)).
- **The run planning and the two commands**: every `cli/src/commands` file the [cli and tools](cli-and-tools.md) note section 1 left for this layer, the 3.3 functions of `artefact-switches.ts` and `document-plan.ts`, `compatibility-check.ts`, `installed-version.ts`, `package-manager.ts`, and `runGenerate`, `runCheck`, `pluginRunOf`, `nativeEntryPolicy` of `run-cli.ts`.

Waits, each refused by name:

| Left out | Where it lands | Until then |
|---|---|---|
| Every family: the 16 TypeScript targets, and the Python, PHP and Kotlin generators | layer 3.4, one crate per family (section 3) | the short id answers `config.target.not-built` (section 3) |
| The family libraries `node-server/`, `front-queries/`, `validators/`, `fetch-client/` and the TypeScript helpers beside them (`planned-names`, `api-index`, `property-key`, `client-filled-headers`, `mounted-base-paths`, `query-list-wire`, `not-generated-forms`) | layer 3.4: the language-neutral planning of rust-rewrite.md "Generators" (kept and refused forms, routes, headers, paging, validation rules) in one shared crate the 3.4 note names, the TypeScript printing in one crate per library | not reached: no 3.3 generator calls them |
| `codegen-axios` importing `codegen-fetch` | layer 3.4: the imported pieces move into the `fetch-client` crate, so no family depends on another | not reached |
| The `exec` protocol | 2.0.0 feature after parity (Order item 4) | `use: exec` answers `config.target.exec-not-available` |
| The `format` config key and the `formatter` hooks | 2.0.0 feature after parity | the key is read as today; the manifest reserves `formatter` (section 3) |
| The 100-column width and the blank-line rules of ADR 0031 "Bytes that change once" | once per family after parity, as the ADR says | the formatter keeps Prettier's settings (80 columns) |
| `seampact test` | after parity | today's `Unknown command 'test'.` |
| The native-entry hand-over (`NativeEntryPolicy` `leave`, `CliIo.nativeOnlyCommands`): a host that runs the Node CLI and keeps the native entries for itself | not ported: in 2.0.0 every generator is in the binary and a launcher holds no generation logic | a native `use` string is a 1.x name, refused with its short id |

## 2. Checking generate and check before the families

### The generator trait

The contract of the external protocol (IR and options in, files and refusals out), in `seampact-target`. Two traits mirror `TargetDefinition` and `Target`: a family writes the typed one; the registry and the planning see the object-safe one through a blanket impl.

```rust
/// What a family implements: the typed half of `defineTarget`.
pub trait TargetDefinition: Sync {
    type Options;
    fn metadata(&self) -> &'static TargetMetadata;
    fn parse_options(&self, raw: Option<&JsonValue>) -> Result<Self::Options, Refused>;
    fn generate(&self, input: &GenerateInput<'_, Self::Options>) -> Result<Generated, Refused>;
    /// Only a provider overrides it.
    fn describe(&self, _ir: &ContractIr, _options: &Self::Options) -> Result<DescriptorSet, Refused> {
        Ok(DescriptorSet::default())
    }
}

/// What the registry holds and the planning calls: the erased `Target` of `define-target.ts`.
pub trait Generator: Sync {
    fn metadata(&self) -> &'static TargetMetadata;
    fn generate(&self, request: &GenerateRequest<'_>) -> Result<Generated, Refused>;
    fn describe(&self, ir: &ContractIr, options: Option<&JsonValue>) -> Result<DescriptorSet, Refused>;
}

impl<Definition: TargetDefinition> Generator for Definition { /* define-target.ts order */ }
```

- The blanket impl runs `define-target.ts` in its order: `refuse_unsupported_ir`, `parse_options`, the link and artefact checks, the target's `generate`. The path check and the finishing (header, formatting) run after it in `seampact-plan` (`entry-generation.ts`), for every `Generator`, so an `exec` generator gets them too.
- `GenerateRequest<'run>`: `ir: &'run ContractIr`, `options: Option<&'run JsonValue>`, `links: &'run LinkSet`, `artefacts: &'run ArtefactSet`, `framework_routes: Option<&'run FrameworkRouteCheck>`, `hook_check: Option<HookBootCheck>`, `mount: Option<&'run str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `native_docs_document: Option<&'run NativeDocsDocument>`, `output_directory: Option<&'run str>`. `GenerateInput<'run, Options>` holds the same with the defaults applied and `options: Options`. Borrowed, so the TypeScript's `structuredClone`s have no counterpart.
- `Generated { files: Vec<GeneratedFile>, warnings: Vec<GenerateWarning> }`; `GeneratedFile { path: String, contents: String }` (the path is checked by the writer, as the protocol's); `Refused(Vec<Refusal>)` with `Display`.
- `TargetMetadata` is `'static` data: `id: TargetId`, `legacy_names: &'static [&'static str]` (the 1.x `use` strings), `role: TargetRole`, `ir_support: IrSupport<'static>`, `artefacts: &'static [ArtefactDeclaration]`, `consumes: LinkNeeds`, `provides: LinkOffers`, `boot_checks: &'static [TunableBootCheck]`, `framework_docs_off_fix: Option<&'static str>`, `import_specifiers: Option<ImportSpecifierStyle>`, `base_paths: BasePathRouting` (`Shared` or `Exclusive`), `compatibility: Option<CompatibilityKey>`. The package version of the TypeScript is the binary's (`CARGO_PKG_VERSION`).
- `assertArtefactDeclarations` throws at load in the TypeScript; the metadata is static here, so it is a registry test over every generator, not a run-time check.
- Every link kind, style, role and boot check is a fieldless enum with `as_str` (cli and tools section 2); `LinkNeeds` and `LinkOffers` are one `Option` field per kind, never a map.

### The stand-in: three probe generators, no family in this layer

No family is ported in 3.3. The cheapest real family is `codegen-ts` (1,363 lines plus about 100 of `codegen-core` helpers), and it reaches the provider path only; the server and consumer paths (boot checks, native docs, base-path routing, consumed links, artefacts) sit behind `node-server/` (4,307 lines, under every server: `codegen-hono` is 70 lines on top of it), `validators/` (1,498), `fetch-client/` (1,073) or `front-queries/` (1,549). Instead:

- The documents path (an app with `openapi` documents and no target entry) reaches run preparation, document planning and emission, merged documents, the writer, the manifest and drift with no generator at all.
- Three probe generators reach the entry path: links, artefacts, refusals, warnings, describe, the boot checks, native docs, import specifier styles, base-path routing, the path check and the formatting. Each answers what its options say and, with `echo: true`, a `request.json` holding the request it received; a mismatch in that file points at the planning, not at a family. Rust: crate `seampact-gen-probe`, in the registry only under the `oracle` feature. TypeScript: three CommonJS `defineTarget` twins under `fixtures/generators/<id>/`, which the TypeScript harness links into `<root>/node_modules/` for every CLI case, so `use: probe-server` reads the same on both sides.

| Probe | Role | Consumes | Provides | Artefacts (`defaultOn`, `needs`) | Other metadata |
|---|---|---|---|---|---|
| `probe-server` | server | `validators` (styles `standard-schema`, `class-validator`; optional, own library `ajv`) | none | `routes` (on), `nativeDocs` (off), `hooks` (off, needs `routes`, left off without it) | boot checks `frameworkRoutes` and `hooks`; `frameworkDocsOffFix`; exclusive base paths |
| `probe-provider` | provider | none | `validators` (`standard-schema`), `types` (`typescript`), `client` (`fetch`) | none | `describe` answers `options.descriptors`, or `options.refusals` |
| `probe-client` | client | `client` (`fetch`), `types` (`typescript`, optional, own library `probe-types`) | none | `queries` (on), `mutations` (on, needs `queries`) | import specifiers `extensionless`; `irSupport.kinds` leaves out the last declaration kind of `seampact_ir`'s list, so `refuse_unsupported_ir` is reached |

Options of every probe: `{ "files"?: [{ "path", "contents" }], "refusals"?: [Refusal], "warnings"?: [GenerateWarning], "echo"?: true, "descriptors"?: DescriptorSet }`. `request.json` is `{ "api", "operations", "links", "artefacts", "frameworkRoutes", "hookCheck", "mount", "importSpecifiers", "nativeDocsDocument"?, "outputDirectory"? }`, `operations` the operation ids of the IR the entry received, `artefacts` sorted, written with `JSON.stringify(value, null, 2)` (`indented_json`).

The first family is the first 3.4 lane (`codegen-ts`, for the reason above); "built before the second family" holds.

### Inert until named

`seampact-generators` builds the registry: `pub fn registry() -> Registry`, a `&'static [&'static dyn Generator]` over unit structs. A lookup by short id is a slice scan; nothing runs, allocates or reads a file before it. The planning receives `&Registry`, so `seampact-plan` never depends on a family and its tests run on the probes alone.

## 3. Crates

| Crate | Directory | Holds | Depends on (beyond `ir`, `json`, `js`, `diagnostics`) |
|---|---|---|---|
| `seampact-paths` | `crates/paths` | `RelativeOutputPath` (`try_new` refuses empty, absolute, `\`, `.` and `..` segments, empty segments, NUL; the reasons of `generated-paths.ts#unsafePathReason`), `OutputPathSet` (refuses two paths equal once case-folded or NFC-normalised), `untrusted_entry_problem` (the tar and git entry rules of bundles, one reason enum each caller words), `case_folded` (moved from `seampact-target`) | `camino`, `unicode-normalization` |
| `seampact-bundle-source` | `crates/bundle-source` | `BundleSource` and its forms, `written_bundle_source` (moved from `crates/bundle/src/source.rs`) | `serde` |
| `seampact-target` | `crates/target` | today's contents; the two traits, `TargetMetadata`, `TargetId`, `TargetRole`, `ArtefactDeclaration`, `ArtefactId`, `ArtefactSet`, links and descriptors, the boot-check and import-specifier types, `GenerateWarning`, `NativeDocsDocument`, `refuse_unsupported_ir`, the link check, `Registry`, the capability data (`compatibility` module: `include_str!` of the two matrix files, parsed on call, never in a global) | `paths` |
| `seampact-format` | `crates/format` | `format_source(source, kind: SourceKind) -> Result<String, FormatSourceError>`, the one function over oxc; `SourceKind` `TypeScript` or `JavaScript`, Prettier's options and 80 columns | `oxc_formatter`, `oxc_formatter_core`, `oxc_allocator`, `oxc_span` |
| `seampact-writer` | `crates/writer` | `check_generated_paths`, `finish_files` (header, `.ts .tsx` through `format_source`, `.js .mjs .cjs` as JavaScript, `.json` parsed and rewritten with `indented_json`), the manifest, `plan_generated_write`, `commit_generated_write`, `read_file_if_present` | `target`, `paths`, `format`, `sha2` |
| `seampact-cli-config` | `crates/cli-config` | gains `select_artefacts`, `plan_app_documents`, `plan_merged_documents` and their helpers, `check_app_compatibility`, `read_installed_version`, `find_package_manager`, `install_fix`; the typed `diff`, `lint`, `openapi` and generate settings | drops `bundle`, gains `bundle-source`, `paths` |
| `seampact-plan` | `crates/plan` | the run planning of `generate` and `check`: `prepare_run`, the app plan, entry links, entry generation, document emission, merged documents, writes, drift; moved from `seampact-cli`: `api_refs`, `contract_position`, `problem_from_refusal`, `in_app`, `app_entry_where` | `target`, `writer`, `cli-config`, `openapi`, `compiler`, `bundle-fetch` |
| `seampact-gen-probe` | `crates/gen-probe` | the three probes | `target` |
| `seampact-generators` | `crates/generators` | `registry()`: every first-party generator, the probes under feature `oracle` | `target`, each `gen-*` crate |
| `seampact-cli` | `crates/cli` | gains `generate_command`, `check_command` and the flag parsing of `runGenerate`, `runCheck` | `plan`, `generators` |

- **Direction.** A generator crate (`gen-*`, and in 3.4 the family libraries) depends on `target`, `ir`, `json`, `js`, `naming` and family libraries only: never on a pass crate, `compiler`, `plan`, `cli`, `cli-config` or another family. `plan` never depends on `generators`. Checks in the seam's gate: `cargo tree -p <gen crate> -e normal` shows no `seampact-pass-`, `seampact-compiler`, `seampact-plan` or `seampact-cli`; `cargo tree -p seampact-cli-config -e normal` shows no `seampact-compiler`; `cargo tree -p seampact-openapi -e normal` shows no `seampact-pass-`.
- **Family crates (3.4)** sit flat as `crates/gen-<short id>` (`seampact-gen-zod`), the libraries as `crates/gen-<library>` (`seampact-gen-node-server`); one crate per unit a lane ports.
- **Short ids.** `TargetId` is the ADR's short id. The registry lists every first-party short id with its `legacy_names`, including the families 3.4 has not built: a short id with no generator yet is `config.target.not-built` ("The target '<id>' is not in this build of seampact yet.", fix "Use the 1.x CLI for this target until its family is ported."), removed when the last family lands. A 1.x first-party string is `config.target.renamed` ("'<string>' is the 1.x name of the target '<id>'.", fix "Write `use: <id>`."). Any other package string is `config.target.external` (fix: an `exec` entry). These codes join the unified refusal list.
- **`CliProblem`** stays in `seampact-cli-config`: `plan` depends on `cli-config` for the loaded configs anyway, and with the traits in `seampact-target` no crate cycles (`cli-config` reads `TargetMetadata` from `target`, `plan` reads both).
- **The writer API.** `plan_generated_write(out_dir: &Utf8Path, owner: &str, files: &[GeneratedFile], policy: HandEditPolicy) -> Result<WritePlanOutcome, WriterError>`, `WritePlanOutcome` `Planned(PlannedWrite)` or `Refused(Vec<Refusal>)`; `commit_generated_write(write: PlannedWrite) -> Result<WrittenFiles, WriterError>`; `WriterError` holds `Io { path, message }` and `Internal`. `HandEditPolicy` `Refuse` or `Overwrite` (`--force`). `PlannedWrite` owns its bytes and paths.
- **The manifest, version 2** ([ADR 0031](../../adr/0031-rust-core.md#formatting)): `{ "version": 2, "owner": <entry id or "openapi">, "files": [{ "path", "source", "sha256", "formatter"? }] }`, files in UTF-16 order of path, written with `indented_json`. Without the `format` key `source` equals `sha256` and `formatter` is absent. A manifest without `version` is read as 1.x, `source` equal to `sha256`; another `version` is `writer.manifest.invalid` with the reason "it is version <n>, which this seampact does not read". `check` compares the regenerated `source` with the manifest's and reports the line (`write-drift.ts`) from the bytes on disk.
- **The generated header** is `Generated by seampact <version> (<short id>) from api "<api id>". Do not edit.`: the 1.x package and its version no longer exist.
- **`NotPortedYet`** as passes.md section 2 in `writer`, `cli-config` (its 3.3 functions), `plan` and `cli`; `seampact-target`, `paths`, `format`, `gen-probe` and `generators` are whole from the seam.
- **Rule ids.** `plan` and `writer` report through `Refusal` and `CliProblem` codes, no `RULE_IDS`; the new codes are listed in `seampact-target`'s unified list.

### The layer 3.2 review inputs

| Input | Place |
|---|---|
| 1 `BundleSource` out of `seampact-bundle` | seam P: `seampact-bundle-source`; `bundle`, `bundle-fetch`, `cli-config` import it, `bundle` re-exports nothing |
| 2 `CliProblem` and `problem_from_refusal` | acceptance for `CliProblem` (above); `problem_from_refusal`, `in_app`, `app_entry_where`, `names_pointer`, `contract_position`, `api_refs` move from `cli` to `plan` in seam G |
| 3 typed `diff`, `lint`, `openapi` settings | seam P: serde forms over the validated config value in `cli-config`, as `bundle_source.rs`; `LoadedAppConfig` exposes them, `cli` stops reading raw members |
| 4 the validated relative path and the untrusted-entry validator | seam P: `seampact-paths`, absorbing the seven sites (`compile_command.rs:153`, `init_command.rs:204`, `write_editor_schemas.rs:29`, `bundle/src/write.rs:95`, `cache.rs:174`, `git_tree.rs:89`, `tarball_read.rs:140`) |
| 5 derivation ids in `seampact-ir` (m17) | seam P: one `derivation_ids` module of `pub const DerivationId`s, one per row of `compiler/src/derivations/table.ts` the Rust uses; the pass crates and `openapi` import them; `openapi` drops `pass-access-identity` and `pass-derive-wire`. The IR crate is lead-owned: the lead approves the module in the seam PR (constants only, no IR format change) |
| 6 `refuseUnsupportedIr` | seam G, `seampact-target` |
| 7 one oracle JSON builder module (M6) | seam P: `crates/cli/src/oracle/json.rs`, before seam G adds the generate subjects |
| 8 IR-to-JSON round trips | acceptance: `check` runs no contract diff (`write-drift.ts` compares file lines), so no round trip is on the path; brief L1 measures `generate` and `check` on `fixtures/scale` and confirms with `rg` that `plan` calls neither `json_of` nor `to_json_value` |
| 9 consumers and `not_ported.rs` | brief L1 (section 8) |
| 10 public surfaces (m15) | seam P: `bundle`, `bundle-fetch` and `openapi` export the entry functions of cli and tools section 5, the types in their signatures and what `plan` calls (`emit_documents`, `merge_documents`, `parse_emitter_options`, `fetch_bundle`); the rest is `pub(crate)`, tested through the entry points |
| 11 the diff report through `diagnostic_inert` | does not apply: `generate` and `check` build no diff report; a baseline from a bundle or a git ref is a `diff` command change outside this layer |

## 4. Third-party crates

| Need | Decision | Settled by |
|---|---|---|
| Formatting generated TypeScript and JavaScript | `oxc_formatter` 0.78.0, `oxc_formatter_core`, `oxc_allocator`, `oxc_span` (0.158.0), all from one git rev (tag `oxfmt_v0.78.0`, rev `7d8e1f49`), each with `version` beside `rev` (cargo-deny refuses a git dependency without one as a wildcard); `deny.toml` allows the oxc repository under `allow-git` and lifts the `icu_segmenter` ban for the wrapper `textwrap` only (oxc_diagnostics reaches it) | spike: 10 of 12 goldens byte-identical to Prettier at 80 columns, the 2 others differ in tokens; `cargo deny`: licences and sources pass once the git source is allowed |
| Formatting generated JSON | none: parsed and rewritten with `seampact_json::indented_json` (`JSON.stringify(value, null, 2)`, Prettier's JSON output for the generators' values) | spike: oxc's `SourceType` refuses `.json` |
| Manifest hashing | `sha2` (pinned) | the TypeScript |
| Reading installed versions and the package manager | none: `installed-version.ts` and `package-manager.ts` read `package.json` files and lockfile names; no process is spawned in this layer | the TypeScript |
| Spawning (`exec`, `format`) | none in 3.3; the 2.0.0 features decide (`std::process::Command` with an argument list, as `fetch-git`) | out of scope |

- oxc adds 25 `oxc_*` crates, `num-bigint` 0.5 beside `jsonschema`'s 0.4, `syn` 3 beside 2 (build only) and the `icu_*` segmenter data; the earlier spike measured +2.76 MB for the binary. `multiple-versions` stays `warn`.
- The pin moves only in a lead PR that reruns the oracle; `oxc_formatter`'s API promises nothing.

## 5. The oracle extension

Before any port lane. Seam T (TypeScript) and seam G (Rust) start together; `scripts/oracle/README.md` documents the final layout and wins over this section.

### Cases

- `generate` and `check` cases are CLI cases (`fixtures/cli/<case>/`, `--tool cli`). `cli.json` gains a second form: `{ "steps": [ { "argv": [string], "cwd"? } | { "write": { "<path under tree/>": "<text>" } } | { "remove": ["<path>"] } ], "env"? }`, run in order on one root. Each side runs its own `generate` before a `check`, so a check case never reads files the other side wrote (their formatting and manifests differ by design).
- Expected: `cli/<NN>-transcript.json` per `argv` step (`NN` from `01`), same shape as `cli/transcript.json`; a one-`argv` case keeps `cli/transcript.json`.
- The probes' TypeScript twins live in `fixtures/generators/probe-*/`, linked into every CLI root's `node_modules/`; the Rust registry has them under the `oracle` feature.
- Corpus: hand-written cases for the documents path (one app, a root with apps and merged documents, every `checks.openapi` and `checks.generated` level, a hand edit, `--force`, a manifest owned by another entry, a removed file), and the CLI tests converted by hand to probe cases (`check-command.test.ts`, `generate-refusals.test.ts`, `native-docs.test.ts`, `filter-operations.test.ts`, `exclusive-base-paths.test.ts`, `import-specifier-styles.test.ts`): their fakes map onto the probes' options. `artefact-switches.test.ts` and `document-plan.test.ts` add recorded `cli-config` calls (`selectArtefacts`, `planAppDocuments`, `planMergedDocuments`) under those cases.
- Hand-ported (no case reaches them in 3.3): `compatibility-check.test.ts`, `installed-version.test.ts` (real framework records need a family), `manifest` reading of 1.x and malformed manifests, the writer's refusals on a symbolic link and a path leaving its root, `RelativeOutputPath` and `OutputPathSet`, `format_source` on the goldens.

### Comparison on the Rust side

- A written file under a directory holding a written `.seampact-manifest.json` is generated output:
  - `.ts .tsx .js .mjs .cjs .json`: output `generated`, compared as token streams with whitespace aside (string, template and comment contents kept whole); the first line's header is normalised on both sides to `// Generated by <generator> from api "<api id>". Do not edit.`, so the api id is still compared. One mismatch is one file; a `differences.yaml` entry with `output: generated`, `path` and `change: format` accepts a formatter's token difference (the spike's `<T,>` and leading `|`).
  - `.seampact-manifest.json`: normalised, output `cli-files`: the Rust manifest must be version 2 with each `source` and `sha256` equal to the SHA-256 of the bytes the Rust side wrote; then `owner` and the ordered `path` list compare by value with the TypeScript manifest. The manifest version and the hashes change once by this normalisation, not by `differences.yaml` entries.
  - `.yaml` and `.json` OpenAPI documents in a directory owned by `openapi`: as `openapi` (parsed YAML, JSON bytes), cli and tools section 4.
- The Rust version string in written texts and streams is replaced by `<version>` before the comparison, as the run root by `<root>`.
- Every other comparison is cli and tools section 4's. `differences.schema.json` needs no new output: `generated` exists; seam G implements its comparison (`OutputKind::Generated` is "not compared yet" today).
- Native `use` strings: the TypeScript says `config.target.native`, the Rust `config.target.renamed`: one `code-renamed` entry per case, recorded by the lead.

## 6. Seam PRs

Three seams. The two in wave 1 share no file: seam T owns `scripts/oracle`, `scripts/rust` and `fixtures/`; seam G owns `crates/`, `Cargo.toml`, `deny.toml` and `xtask`.

### Seam P: prerequisites (`gen-prep`, N5)

Before the others, alone. Inputs 1, 3, 4, 5, 7, 10 of section 3: `seampact-paths` (whole, with its tests), `seampact-bundle-source`, the typed settings, the derivation-id constants and m17, the m15 narrowing, `oracle/json.rs`. Behaviour does not change: the whole oracle matches before and after. It freezes `RelativeOutputPath` and the settings types, hence N5; it ports no TypeScript body.

### Seam T: the TypeScript oracle extension (`gen-oracle`, N3)

The `steps` form of `cli.json`, the probe twins and their linking, the cases and converted tests of section 5, the recorded `cli-config` calls, the README section (first commit), and in `scripts/rust`: `trace.ts` reads the tables of `GENERATOR_TABLES_DIR` beside `TOOL_TABLES_DIR` (a crate may have a table in both), then a rerun of `generator-coverage.ts`, which recuts the briefs of section 8 from the cases' pairs.

### Seam G: the generator skeleton (`gen-seam`, N5)

Merges after seam T, rebased, with every generate and check case `NotPorted` or matching.

- Crates `format`, `writer`, `plan`, `gen-probe`, `generators` (`Cargo.toml`, `lib.rs`, empty `trace.tsv`, `src/not_ported.rs` and the `allow` where stubs remain), the moves of input 2.
- Whole: the `seampact-target` contract of section 2 (the 446 function lines of `target.tsv` and the capability data), `format_source`, the probes, the registry and its metadata test.
- Stubs with the TypeScript's parameters: `seampact-writer` (every function of `writer.tsv`), the 3.3 functions of `cli-config.tsv`, `seampact-plan` (`prepare_run`, `committable_writes`, `commit_writes`, `find_write_drift` and every function of `plan.tsv`), `generate_command` and `check_command`. `run_generate` and `run_check` parse their flags (`pluginRunOf` is ported whole: usage errors keep their text) and call the stubs, replacing the `cli.not-ported` arm.
- The Rust oracle: the `steps` reader, `generated` token compare, the header, version and manifest normalisation; `crates/cli/src/oracle/` wires the generate cases through `run_command` with the `oracle` feature's registry.
- `Cargo.toml`: the new crates, the oxc pins; `deny.toml`: `allow-git` and the `icu_segmenter` wrapper; xtask gate: the `cargo tree` direction checks of section 3 as one step (`deps: ok`).
- The unified refusal list gains `config.target.renamed`, `config.target.external`, `config.target.not-built`, `config.target.exec-not-available`.

A seam that freezes a type runs at N5 (Opus, effort high), about twice a port lane's N2 (Sonnet medium) per line; seams G and P hold types, signatures and the contract's bodies only, and every other body goes to an N2 brief.

## 7. Coverage tables

- `scripts/rust/generator-coverage.ts` writes one TSV per crate in `docs/maintainers/rust-design/generators/` (`paths`, `target`, `writer`, `cli-config`, `plan`, `cli`; the columns of passes.md section 6). It reuses `toolUnitsOf` and `toolSourceFileOf` of `tools-coverage.ts`, `cutBriefs`, `coverageTable`, `pairsOf` and `CoverageProbe` of `pass-coverage.ts`, and the CLI pairs of `tools-pairs.ts`: a generate or check case is a CLI case.
- Rerun: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/generator-coverage.ts`.
- Today no CLI case runs `generate` or `check`: every pair count is 0 and the briefs follow the source order of the script (the documents path first). Seam T's rerun recuts them from the cases; the TSV is authoritative over the tables below.

| Crate | Function lines | Skeleton (Rust lines, estimate) | Briefs | Lines per brief |
|---|---|---|---|---|
| `paths` | 17 (plus the bundle entry rules moved in) | 15 | in seam P | 17 |
| `target` | 446 (plus the matrix data) | 525 | in seam G | 446 |
| `writer` | 488 | 450 | 1 | 488 |
| `cli-config` | 878 | 840 | 1 | 878 |
| `plan` | 1,558 | 1,215 | 2 | 988 570 |
| `cli` | 153 | 90 | 1 | 153 |

## 8. Briefs

Cut rule and conventions: passes.md section 7 and cli and tools section 7 ("Brief conventions"). A brief names its functions by `rg '^<n>\t' docs/maintainers/rust-design/generators/<crate>.tsv`, in the "files under" and "name file.ts:a-b" shape of the context packs, the oracle command `cargo xtask oracle --tool cli '<glob>'` and the TypeScript test files of its files ("ledger from the converted cases"; hand-ported only what section 5 lists).

| Brief | Crate | Files (TypeScript, `rg '^<n>\t'` of the TSV) | Reached by |
|---|---|---|---|
| W1 | `writer` | `codegen-core/src`: `file-presence`, `generated-paths` (but `unsafePathReason`, `caseFolded`), `manifest`, `writer`, `finish-files` | every case that writes; the documents cases first |
| C1 | `cli-config` | `cli/src/config`: the rest of `document-plan` and `artefact-switches`, `package-manager`, `installed-version`, `compatibility-check` | documents cases (`planAppDocuments`), probe cases (`selectArtefacts`); hand-ported tests for the last three |
| P1 | `plan` 1 | `cli/src/commands`: `drift-level`, `run-preparation`, `app-plan`, `document-emission`, `merged-documents`, `write-plan`, `write-drift`, `native-entries`, `filter-operations`, the first half of `entry-links` | the documents cases |
| P2 | `plan` 2 | the rest of `entry-links`, `link-set`, `entry-generation`, `import-specifier-styles`, `framework-route-check`, `framework-docs`, `exclusive-base-paths`, `native-docs-document` | the probe cases |
| L1 | `cli` | `generate-command`, `check-command`; the end of the layer below | every generate and check case |

L1 also ends the layer's stubs: it deletes `crates/cli/src/not_ported.rs`, `CliError::NotPortedYet`, the `StubError` impls and `stub_answer.rs` once no crate has a `NotPortedYet`, and the `expect(dead_code)` items of `cli_problem.rs` and `lib.rs` that moved to `plan` or now have callers (`read_workspace_configs`, `read_run_config`, `api_refs`, `contract_position`); it runs the measurement of input 8 and records it in its hand-back. End check: `rg 'NotPortedYet|not_ported|not-ported|StubError|allow\(dead_code|expect\(dead_code|pending:' crates/{cli,cli-config,plan,writer}` prints nothing, and `cargo xtask oracle --tool cli` reports 0 not ported.

Five briefs over four units, plus the contract in seam G and the paths in seam P.

## 9. Wave plan

At most four cargo lanes at once; one PR per brief; port lanes N2.

- **Wave 0**: seam P (N5), alone.
- **Wave 1**: seam T (N3) and seam G (N5) in parallel; seam G merges second.
- **Wave 2**: W1, C1 and P1 in parallel. An Opus pattern review after the first merged brief that ports bodies (W1 or C1); its findings amend this note before P2.
- **Wave 3**: P2 (after P1), then L1 (after every other brief).
- **Layer review** at the end, then the 3.4 note (families, the shared planning crate, the family libraries) before the first family lane.
- A lane rebases on `feat/rust-core` between briefs and reruns the whole oracle.

## 10. PORTING.md and docs

- PORTING.md section 4: the `steps` cases and the `generated` comparison (this PR). Section 9: the oxc crates by git rev, and `icu_segmenter` allowed only through `textwrap` (this PR).
- [cli and tools](cli-and-tools.md) section 1: the waiting rows now point here; `exec` and `format` are 2.0.0 features after parity, not layer 3.3 (this PR).
- [rust-rewrite.md](../rust-rewrite.md) "Generators": the shared planning of that section is the 3.4 crate; `seampact-plan` here is the run planning (this PR).
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
