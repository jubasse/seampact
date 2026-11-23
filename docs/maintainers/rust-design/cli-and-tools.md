# Rust design: OpenAPI, diff, lint, bundles and the CLI

Layer 3.2 of the 2.0.0 port ([rust-rewrite.md](../rust-rewrite.md), "Order"): the OpenAPI emitter (`packages/core/openapi`), the diff (`diff`), lint (`lint`), bundles (`compiler/src/bundle`, `spec/src/bundle`) and the CLI (`cli`) with the `codegen-core` pieces they import. It applies [PORTING.md](../../../PORTING.md) and reuses the shapes of the [passes](passes.md) note (sections 2, 6 and 7 above all). A lane uses these shapes as given; a gap goes to the lead. Evidence for the choices that depend on Rust or crate behaviour is in "Spike evidence".

## 1. Scope

Ported in this layer:

- **OpenAPI** as a library: `emitDocuments`, `parseEmitterOptions`, `findDocumentDrift`, `mergeDocuments`, the extension names. No 3.2 command writes a document: documents are written by `generate` and `check`, so the emitter is reached only by the oracle until layer 3.3.
- **Diff** and `seampact diff` (the baseline read included).
- **Lint**: the core rules, `runLint` and `seampact lint`. The plugin API (`plugin-loader.ts`, `defineLintPlugin`, `isDefinedLintPlugin`) is not ported: ADR 0031 removes it and the CLI already passes `plugins: []`.
- **Bundles**: build, write (directory, tarball, npm package), read, verify, the cache, the three channels (`package`, `git`, `release`), workspace imports, and `seampact bundle`. A `maven` source keeps today's refusal by name.
- **The CLI**: the `seampact` binary, dispatch, help and usage, the waiting flags (`--watch`, `--strict`, `--source-map` keep `cli.not-available`), `compile` (`--out`, `--editor-schemas`), `lint`, `diff`, `bundle`, `explain`, `init` (both forms) with modelines, git-ignore and editor schemas, and config reading (app, root, workspace and run configs; of `artefact-switches.ts` and `document-plan.ts` only `isFrameworkRouteCheckOff`, `frameworkRoutesSwitchOf` and `openApiApiNames`, which `read-app-config.ts`, `compile` and `diff` call).

Waits for layer 3.3 (generator infrastructure, designed in [generators](generators.md)), each refused by name until then:

| Left out | Where it lands | Until then |
|---|---|---|
| `generate`, `check` and what only they reach: `app-plan`, `run-preparation`, `write-plan`, `write-drift`, `drift-level`, `merged-documents`, `document-emission`, `entry-generation`, `entry-links`, `link-set`, `native-entries`, `native-docs-document`, `framework-docs`, `framework-route-check`, `import-specifier-styles`, `exclusive-base-paths`, `filter-operations` | 3.3, crate `seampact-cli` | the command answers `cli.not-ported` (below) |
| the writer, the manifest and its `"version": 2` (ADR 0031 "Formatting"), the writer half of `generated-paths.ts` | 3.3 seam, crate `seampact-writer` | not reached: 3.2 commands write with `std::fs` as the TypeScript does |
| target resolution (`resolve-target.ts`, replaced by the target registry and short ids), `compatibility-check.ts`, `installed-version.ts`, `package-manager.ts` | 3.3 | not reached: `compile` reads `use` as text and never resolves it, as today |
| the rest of `artefact-switches.ts` (`selectArtefacts` and its helpers) and of `document-plan.ts` (`planAppDocuments`, `planMergedDocuments` and their helpers): they read `Target`, `ArtefactDeclaration` and `TargetRole`, and only 3.3 files call them | 3.3, crate `seampact-cli-config` | not reached |
| the `exec` protocol, the `format` config key | 2.0.0 features after parity ([generators](generators.md), section 1) | config keys read as today |
| `seampact test` | after parity (Order item 4) | today's `Unknown command 'test'.` |
| watch mode (`load/watch.ts`) | a later feature | `--watch` keeps `cli.not-available` |

- **The generator writer seam** of "Order" item 2 does not exist yet. It belongs to layer 3.3 (seam G of [generators](generators.md), section 6), crate `seampact-writer` (`writer.ts`, `manifest.ts`, `file-presence.ts`, `finish-files.ts`, the writer half of `generated-paths.ts`). No 3.2 command needs it.
- **`cli.not-ported`**: a `CliProblem` whose message reads "`seampact <command>` is not ported to this build yet." and whose fix reads "Use the 1.x CLI for `<command>` until the generator layer lands.", exit code 2 (`EXIT_USAGE`), as `cli.not-available`. The CLI has two entries: `run_command(argv, io) -> Result<i32, CliError>` keeps `CliError::NotPortedYet { function }`, and the `generate` and `check` arms answer it (`runGenerate`, `runCheck`) before parsing their flags; `run_cli(argv, io) -> i32`, the binary's wrapper, maps `NotPortedYet` to `cli.not-ported`, with the TypeScript function name in the message. The oracle calls `run_command`, so a case that reaches a stub is `NotPorted`, never a mismatch. The code disappears with the last 3.3 brief: its end check adds `rg 'not-ported' crates/cli/src` to the `rg` below.
- **Within a crate**, unported functions follow passes.md section 2: a crate error enum with `NotPortedYet { function: &'static str }` and `Internal(#[from] InternalError)`, stubs built only through `src/not_ported.rs`, the `allow(dead_code)` in `lib.rs` while stubs exist, and the end-of-crate check of section 7, "Brief conventions". The oracle maps `NotPortedYet` to `NotPorted` (skipped, never a match).

## 2. Crates

| Crate | Directory | Holds (TypeScript under `packages/core/`) | Depends on (beyond `ir`, `json`, `js`, `diagnostics`) |
|---|---|---|---|
| `seampact-target` | `crates/target` | `codegen-core/src`: `refusal.ts`, `ir-location.ts`, `located-refusals.ts`, `unknown-value.ts`, `ir-support-refusal.ts`, `not-generated-fixes.ts`, `generated-paths.ts#caseFolded` | none |
| `seampact-openapi` | `crates/openapi` | `openapi/src`, `merge/` included | `target`, `saphyr` |
| `seampact-diff-table` | `crates/diff-table` | `diff/src`: `diff-codes.ts`, `result.ts`, `options.ts`, `table/` | none |
| `seampact-diff` | `crates/diff` | `diff/src`: `diff-contracts.ts`, `walk/`, `gate/`, `deprecation/`, `report/` | `diff-table` |
| `seampact-lint` | `crates/lint` | `lint/src` but the plugin loader | `pipeline` (the declared list), `span`, `authoring` (`Locations`), `naming`; `closest_keyword` from the crate it moves to (lead PR before cli-config 1) |
| `seampact-bundle` | `crates/bundle` | `spec/src/bundle`; `compiler/src/bundle`: `contents`, `integrity`, `ustar`, `tarball-write`, `build`, `write`, `untrusted-json`, `manifest-read`, `ir-check`, `tarball-read`, `verify`, `local-packages`, and `fetch-package.ts#installedPackageDirectory` (a `node_modules` lookup that `local-packages` calls; no network) | `compiler`, `ir-check`, `flate2`, `sha2`, `jsonschema` |
| `seampact-bundle-fetch` | `crates/bundle-fetch` | `compiler/src/bundle`: `fetch`, `fetch-failure`, `imports`, `cache`, `local-sources`, `printable-url`, `fetch-package` (but `installedPackageDirectory`), `fetch-git`, `fetch-release` | `bundle`, `compiler`, `ureq`, `rustls` |
| `seampact-cli-config` | `crates/cli-config` | `cli/src/config` but the four files and the 3.3 functions of section 1 | `load` (its `yaml` module), `bundle` (source types), `target` (`case_folded`), `jsonschema` |
| `seampact-editor-schemas` | `crates/editor-schemas` | `cli/src/editor-schemas` | `pipeline`, `cli-config` |
| `seampact-cli` | `crates/cli` | `cli/src`: `run-cli`, `cli-io`, `cli-problem`, `error-code`, `symbolic-link`, `is-record`, and the 3.2 commands; the binary `seampact` (`src/main.rs`) | every crate above, `compiler`, `anyhow` (binary only) |

- Direction: `openapi`, `diff`, `lint` and `bundle` never depend on `cli` or `cli-config`; `compiler` never depends on `bundle` or `bundle-fetch`, so the compiler stays network-free; only `bundle-fetch` reaches the network and runs `git`. `diff-table` is apart so its lane (the table data and the result types) runs beside the first `diff` briefs.
- `cli-config` depends on `bundle` only for the source types, which brings in `compiler`. Acceptable here, since the CLI links both anyway; layer 3.3 does not copy the pattern: a crate that needs only types from a heavy crate gets them moved to a light one.
- **The bundle manifest's `compiler` member** is `{ "name": "seampact", "version": <the workspace version> }` (`CARGO_PKG_VERSION` of `seampact-bundle`), where the TypeScript writes the npm `@seampact/compiler` name and version. The bundle integrity covers the listed files, not the manifest, so pins keep working; the comparisons that see the manifest normalise it (section 4), and ADR 0031 "Bytes that change once" lists the change.
- **The binary** is the `[[bin]] name = "seampact"` target of `seampact-cli` (`src/main.rs`: read `std::env::args_os`, call `run_cli` with the process `CliIo`, exit with its code). `anyhow` stays in `main.rs`; printing is allowed only in the `cli_io` module.
- **`seampact-target`** holds what OpenAPI and the CLI import from `codegen-core`, so the planning crate of layer 3.3 (`seampact-plan`) depends on it and extends it without a move:
  - `Refusal { code, message, fix, operation: Option<OperationId>, member: Option<String>, docs: Option<String> }`, `without_repeats` (the key is the TypeScript's `JSON.stringify([code, member, operation])`, ported as the same string);
  - `IrLocation { member: String, operation: Option<OperationId> }` with `below(&self, segments)`, `schema_location`, `operation_location`; segments escape through `seampact_json::escape_pointer`;
  - the located refusals (`refuse_not_generated_yet`, `refuse_unknown_value_at`, `refuse_inconsistent_ir`) and `NotGeneratedForm`: the `NOT_GENERATED_FIXES` keys as a fieldless enum with `as_str`, `fix` and `section` (`GenerateTroubleshootingSection`), and the troubleshooting URL constants. The 3.3 unified refusal list ("one code per fault") grows this enum;
  - `case_folded` (used by `read-app-config.ts`; the 3.3 writer reuses it);
  - not modelled now: `TargetRole`, artefact declarations and the per-target capability data the compatibility check reads. They have no 3.2 consumer; layer 3.3's seam adds them as modules of this crate ([generators](generators.md), section 3).
- `compareCodeUnits` is `seampact_js::cmp_utf16` (a skip line). `spec/src/ir/support.ts#checkIrSupport`, which OpenAPI reaches, is a module of `seampact-ir`, ported by the first OpenAPI brief that reaches it, as passes.md section 1 does for the IR helpers. `check_ir_support` reads an untrusted JSON document (bundle, diff entry). OpenAPI, which holds a typed `ContractIr`, calls `check_contract_ir_support`, which reads the same members from the typed IR rather than re-encoding the whole IR. `IrSupportMismatch.operation` is an `Option<OperationId>`.
- Shared building blocks every tool crate uses: `JsonNumber::from_i64` (infallible) in `seampact-json`; `JsonObject::from_members` / `JsonValue::text` in `seampact-json` and derivation ids as `pub const DerivationId`s in `seampact-ir` (the pipeline table and the pass crates import them), both added by the lead before openapi 2. A tool crate never converts an integer through its text and never retypes a derivation id.
- A TypeScript closed list (`EXTENSION_NAMES`, `OpenApiForm`, a derivation or definition name set) is an enum or a shared constant from the first brief that names it, never a string newtype or `&str` parameter; `ExtensionName` is a fieldless enum with `as_str` and `ALL`, and `refuse_not_emitted` takes `NotGeneratedForm`.
- Rule ids: each crate that reports diagnostics (`lint`, `bundle`, `bundle-fetch`, `cli-config`, `editor-schemas`, `cli`) has `pub const RULE_IDS: &[RuleId]` and one rule enum with `const fn rule_id(self)` and `const ALL` (passes.md section 7); OpenAPI and diff answer refusals and codes from `seampact-target` and `DIFF_CODES`, no rule ids.

## 3. Third-party crates

| Need | Decision | Settled by |
|---|---|---|
| CLI arguments | No `clap`. `seampact-cli` `args.rs` ports the strict subset of Node's `util.parseArgs` the CLI uses (string and boolean options, `multiple`, `--name=value`, `--`, last value wins) with Node's messages; the usage text is already hand-written data | spike: clap differs on 7 of 7 error texts and refuses a repeated option that Node lets win |
| OpenAPI YAML | `saphyr` `=0.3.4` (the emitter over the pinned `saphyr-parser` 0.3.4, no second parser version); numbers go in as `Yaml::Representation(token, Plain)` so the JSON number token is kept; the leading `---` is stripped and a final newline added | spike: 318 of 318 fixture documents parse back to the TypeScript value, 72 byte-identical |
| gzip | `flate2` (default `miniz_oxide` backend), `GzBuilder` with mtime 0, OS byte 255, `Compression::best()` | spike: 995 against Node's 991 bytes, same header; each side reads the other's stream |
| tar | No `tar` crate: `ustar.ts`, `tarball-write.ts` and `tarball-read.ts` write and read ustar themselves, with the bundle's own refusals; they port as they are, so the uncompressed bytes stay | the TypeScript |
| HTTPS (release channel) | `ureq` 3, default features off, `rustls-no-provider` and `platform-verifier`; `rustls` 0.23 with the `ring` provider passed through `TlsConfig`. `https_only`, `max_redirects(0)` (the channel follows redirects itself, as `fetch-release.ts`, with its checks and messages), a global timeout, a body limit, `proxy(None)` as Node's `https.get` | spike: static musl binary, OS store, loopback CA, redirects |
| git (git channel) | `std::process::Command` with an argument list, as `fetch-git.ts`; the timeout polls `try_wait` and kills | the TypeScript; `git2` is a C build, `gix` a large tree |
| JSON Schema (config, bundle manifest, bundle IR, diff baseline) | `jsonschema` (pinned); the bundle and baseline IR checks go through `seampact-ir-check`; config schema errors convert in `cli-config` as `config-file.ts` converts ajv's | passes.md spike (`jsonschema` against ajv); messages change once (ADR 0031 "Bytes that change once") |
| YAML reading (configs, workspace api names) | `seampact_load::yaml` | the loader note |
| Integrity | `sha2` (pinned) | the TypeScript |

- **`ring` needs a C compiler for its target.** The x86_64 musl build passes with `CC_x86_64_unknown_linux_musl=gcc`; without it, `ring` and `aws-lc-sys` both stop (`x86_64-linux-musl-gcc` not found). The release layer builds each triple with a C compiler: `musl-tools` or `cargo-zigbuild` for the two Linux triples, Xcode clang for macOS and MSVC for Windows (ring ships pregenerated assembly there); the macOS and Windows cost is expected, not probed, and the release-layer spike confirms it. `deny.toml` bans `ring` today; seam R lifts that ban with the wrappers `rustls` and `rustls-webpki` only (`rustls-webpki` depends on `ring` directly, `rustls` turns it on; `ureq` reaches it only through `rustls`), and keeps `aws-lc-sys` and `reqwest` banned. `rustls-graviola` (pure Rust) built and handshook the same in the spike; it is the fallback only (0.4, experimental; its CPU-feature floor is checked before any use).
- **Root certificates**: the platform verifier reads the OS store. On Linux `SSL_CERT_FILE` replaces the store, which the channel smoke's native legs use for their loopback CA (Node's `NODE_EXTRA_CA_CERTS` adds to the store instead). `webpki-roots` is not used: its CDLA-Permissive-2.0 licence is outside the `deny.toml` list.

## 4. The oracle extension

Before any port lane. The TypeScript side writes the cases and expected outputs (seam T, section 5); the Rust side reads and compares them (seam R). The shapes below are complete enough for both seams to start at once; `scripts/oracle/README.md` documents the final layout and wins over this section where they differ, and a difference found by seam T goes to the lead before seam R merges.

### Cases and expected files

| Unit (`--tool`) | Case | Expected, under `fixtures/expected/<case path>/` | Corpus |
|---|---|---|---|
| `openapi` | every fixture api with an IR (default options); `fixtures/converted/openapi/<test stem>/<case>/` with `openapi.options.json` | `openapi/<api>/<document>.yaml` (`<document>` the `api.documents` key, `default` for the one document of an api that declares none), or `openapi/<api>.refusals.json` | 306 fixture apis today, plus the converted `openapi` tests |
| `openapi-merge` | `fixtures/openapi-merge/<case>/merge.json` | `openapi-merge/merged.yaml` or `openapi-merge/refusals.json` | converted `merge/*.test.ts` |
| `lint` | every fixture api that compiles; `fixtures/converted/lint/<test stem>/<case>/` | `lint/<api>.json`, written only when non-empty | every compiled fixture, plus the converted lint tests |
| `diff-table` | none: one global case | `fixtures/expected/diff-table.json`: `{ "codes": DIFF_CODES, "table": DIFF_TABLE, "memberRows": MEMBER_ROWS }` (`memberRows` is a seam T change), so the expanded member rows are compared | the table data whole |
| `diff` | `fixtures/diff/<case>/` and `fixtures/converted/diff/<test stem>/<case>/`, each with `before/` and `after/` (fixtures of their own) and an optional `diff.options.json` | `diff/result.json`, `diff/report.txt` | the converted diff tests |
| `bundle` | `fixtures/bundle/<case>/` holding a workspace and `bundle.json` | `bundle/files.json`, `bundle/manifest.json`, `bundle/integrity.txt`, `bundle/ustar.json`, or `bundle/refusals.json` | the converted `bundle.test.ts` cases |
| `cli-config`, `editor-schemas`, `bundle-fetch` | the calls a CLI case makes, recorded | `<unit>/<NN>-<function>.json` under the CLI case | every CLI case that reaches them |
| `cli` | `fixtures/cli/<case>/` and `fixtures/converted/cli/<test stem>/<case>/`: `cli.json` and `tree/`, the project | `cli/transcript.json` | the converted tests of the 3.2 commands |

One JSON shape per case file:

- `openapi.options.json`: the raw `openapi` emitter options as the config holds them and `parseEmitterOptions` reads them, `{ "extensions"?, "reasons"?, "inputSchemas"?, "servers"? }`; absent means the defaults.
- `merge.json`: `{ "name": string, "prefix": { "<api>": string }, "emitter"?: <raw emitter options>, "inputs": [{ "fixture": "<fixture path under fixtures/>", "api": string, "document"?: string, "operations"?: [string] }] }`. Each input's IR is the expected `ir/<api>.json` of that fixture, kept to the listed operation ids when `operations` is present (`MergeInput.ir` holds only the operations the app serves).
- `diff.options.json`: `{ "today": "YYYY-MM-DD", "gate"?: <DiffGateScope>, "exempt"?: [<DiffExemption>] }` in the TypeScript's member names; absent means `{ "today": "2026-01-01" }`, so no case reads the clock.
- `bundle.json`: `{ "workspace"?: "<path of the workspace file relative to the case, workspace.yaml by default>", "name"?: string, "version"?: string }`; an absent name or version comes from the case's `package.json`, as `seampact bundle` does.
- `cli.json`: `{ "argv": [string], "cwd"?: "<directory relative to tree/, . by default>", "env"?: { "SEAMPACT_CACHE_DIR"?: "<directory relative to the run root>", "SEAMPACT_ALLOW_LOCAL"?: string } }`. Any other variable name is refused by both readers; when `SEAMPACT_CACHE_DIR` is absent both harnesses set it to `<root>/.cache`, so no case touches the home directory. The expected transcripts are written with the Node version the repository pins: `parseArgs` messages change between Node versions.
- `git-source/<tag>/`: beside `tree/`, one directory per tag; both harnesses build `<root>/git-source.git` (a bare repository, each directory committed in name order and tagged with its name), and the case's config names it by the relative path `../git-source.git`.

One JSON shape per expected file:

- `openapi/<api>/<document>.yaml`, `openapi-merge/merged.yaml`: the YAML text.
- `*refusals.json` (OpenAPI, merge): `[{ "code", "message", "fix", "operation"?, "member"?, "docs"? }]`, the `Refusal` list in emit order. `bundle/refusals.json`: the `BundleFailure` list as the TypeScript returns it.
- `lint/<api>.json`: the diagnostics `runLint` gives, each in the shape of one entry of `diagnostics.json`, sorted as it sorts them. The lint config is the compiled IR's own (`runLint` reads it there); `declared` and `locations` come from compiling the fixture, so a lint case needs no file of its own.
- `diff-table.json`: `{ "codes": DIFF_CODES, "table": DIFF_TABLE }` as `JSON.stringify` writes them.
- `diff/result.json`: the `DiffResult` of `diffContracts` as `JSON.stringify` writes it, or `{ "<api>": DiffResult }` in api-name order (`diffContractSets`) when `before/` or `after/` holds several apis; `diff/report.txt`: `formatDiffReport`'s text, for several apis each report preceded by a line `== <api> ==`, a blank line between reports.
- `bundle/files.json`: `[{ "path", "size", "sha256" }]`, the files the manifest lists (the manifest is not one of them); `bundle/manifest.json`: the manifest's bytes; `bundle/integrity.txt`: the integrity and a newline; `bundle/ustar.json`: `[{ "path", "size", "mode", "uid", "gid", "mtime", "type", "uname", "gname", "sha256" }]`, one per tar entry in order, with `size` and `sha256` left out for `seampact-bundle.json` (the header byte layout is checked by the vectors test).
- `<unit>/<NN>-<function>.json` (`cli-config`: `readAppConfig`, `readRootConfig`, `readWorkspaceConfigs`, `readRunConfig`; `editor-schemas`: `editorDeclarations`, `writeEditorSchemas`; `bundle-fetch`: `fetchBundle`, `compileWorkspaceWithImports`): `{ "function": string, "args": [...], "result": <the answer as JSON.stringify writes it>, "written"?: { "<path>": { "sha256", "text"? } } }`, `NN` the call's position in the case, every absolute path written relative to the run root as `<root>/...`. The Rust subject replays each call on the case's tree as it was before the command; the recorded calls are reads that come before the command's writes.
- `cli/transcript.json`: `{ "exit": number, "stdout": string, "stderr": string, "written": { "<path>": { "sha256": string, "text"?: string } }, "removed": [string] }`, paths relative to the run root, the run root written `<root>` in both streams, `text` present for UTF-8 files.

- **Converted tests.** As the passes' converted fixtures: the TypeScript oracle records each `runCli`, `emitDocuments`, `mergeDocuments`, `runLint`, `diffContracts`, `diffContractSets` or `buildBundle` call a unit test makes (an instrumented run of that package's tests) and writes one case per distinct input whose output is not empty. CLI tests that build fake targets (`defineTarget`, fake target packages) are `generate` and `check` cases: not converted in this layer.
- **Discovery.** Fixture discovery stops below a directory holding `cli.json`: a CLI case's tree is compiled through the CLI only. `before/` and `after/` of a diff case are fixtures and get the compile expected tree as any other. Both oracles apply this rule.
- **Network.** No case reaches the network. `package` cases carry their `node_modules` in `tree/`; `git` cases use `git-source/` with `SEAMPACT_ALLOW_LOCAL` set, and `git` must be on the PATH. The `release` channel has no oracle case: `seampact-bundle-fetch` takes the HTTPS get as a `trait ReleaseGet` (production: `ureq`), hand-ported tests answer recorded responses, and the real TLS path is checked by the channel smoke's native legs (`scripts/dist-smoke`, `cli.ts serve`) at milestones.

### The `ToolSubject` trait

`seampact-oracle` owns the answer types, as `OracleSubject` owns `Compilation` and `HalfOutput`: every tool answers JSON values and text, and `seampact_cli::oracle` converts the crates' types to them through serde forms local to that module, never derives on the shared types.

```rust
pub trait ToolSubject {
    fn openapi(&self, ir: &JsonValue, options: Option<&JsonValue>) -> SubjectAnswer<OpenApiAnswer>;
    fn openapi_merge(&self, case: &MergeCase) -> SubjectAnswer<OpenApiAnswer>;
    fn lint(&self, fixture: &Fixture, api: &str) -> SubjectAnswer<JsonValue>;
    fn diff_table(&self) -> SubjectAnswer<JsonValue>;
    fn diff(&self, case: &DiffCase) -> SubjectAnswer<DiffAnswer>;
    fn bundle(&self, case: &BundleCase) -> SubjectAnswer<BundleAnswer>;
    fn recorded_call(&self, unit: RecordedUnit, call: &RecordedToolCall, root: &Utf8Path) -> SubjectAnswer<RecordedAnswer>;
    fn cli(&self, case: &CliCase, root: &Utf8Path) -> SubjectAnswer<Transcript>;
    fn rule_id_registry(&self) -> RuleIdRegistry;
}
```

- `OpenApiAnswer`: `Documents(Vec<(String, String)>)` (document name, YAML text) or `Refusals(JsonValue)`.
- `MergeCase`: the parsed `merge.json` with each input's IR read; `DiffCase`: the two fixture directories and the options value; `BundleCase`: the case directory and the parsed `bundle.json`; `CliCase`: the parsed `cli.json`; `root` a fresh copy of the case's `tree/` (and `git-source.git`) that the harness owns and deletes.
- `DiffAnswer { result: JsonValue, report: String }`; `BundleAnswer`: `Built { files: JsonValue, manifest: String, integrity: String, ustar: JsonValue }` or `Refused(JsonValue)`.
- `RecordedUnit`: `CliConfig`, `EditorSchemas`, `BundleFetch`; `RecordedToolCall { function: String, args: Vec<JsonValue> }`; `RecordedAnswer { result: JsonValue, written: IndexMap<String, Vec<u8>> }`.
- `Transcript { exit: i32, stdout: String, stderr: String, written: IndexMap<String, Vec<u8>>, removed: Vec<String> }`; the harness hashes the bytes. `cli` calls `seampact_cli::run_command` (section 1): a `NotPortedYet` answers `NotPorted`.

### Comparison on the Rust side

- OpenAPI YAML: both files parsed with `seampact_oracle::yaml_to_json`, then compared as JSON (values and member order). Seam R makes that reader resolve a plain mapping key by the core schema and refuse a key that is not a string, so a plain `200:` or `true:` key no longer equals a quoted one; the `proptest` round trip uses the same reader. The YAML text changes once (ADR 0031), so no `differences.yaml` entry is needed for quoting or wrapping; a value or order difference is a mismatch.
- Refusals, lint, `diff-table.json`, `diff/result.json`, `bundle/files.json`, `bundle/ustar.json`, recorded call results: JSON by value, as `diagnostics.json`. `integrity.txt`: bytes.
- **The manifest.** `bundle/manifest.json` is compared by bytes once the oracle has set `/compiler` to `null` on both sides and rewritten each with the canonical writer (section 2: the Rust value is `seampact` and the workspace version). The integrity does not cover the manifest, so `integrity.txt` needs no normalisation; `ustar.json` leaves the manifest entry's size and hash out for the same reason. In a CLI transcript, a written `seampact-bundle.json` is compared as `bundle/manifest.json`, and a written `.tgz` is gunzipped and compared as `bundle/ustar.json` (its gzip bytes change once).
- Text (`diff/report.txt`, CLI `stdout` and `stderr`): line by line, a mismatch addressed by the pointer `/<line index>`. CLI `exit`: value. CLI and recorded `written`: per path, the `sha256`, and the text diff when `text` is present.
- `differences.schema.json` gains the outputs `openapi`, `openapi-refusals`, `openapi-merge`, `lint`, `diff-table`, `diff-result`, `diff-report`, `bundle-files`, `bundle-manifest`, `bundle-integrity`, `bundle-ustar`, `bundle-refusals`, `cli-config`, `editor-schemas`, `bundle-fetch`, `cli-exit`, `cli-stdout`, `cli-stderr`, `cli-files`. Expected diagnostic text changes from ajv (config schema errors) and parser messages (YAML syntax errors in configs) are recorded there by the lead, as the loader note's section 10.

### Hand-ported tests

No fixture reaches these; the lane ports them as Rust tests of the same behaviour:

- the bundle vectors (`packages/core/spec/vectors/bundle/vectors.json`), read directly; hostile tarballs (`raw-tarball.test-support.ts` cases of `tarball-read.test.ts`), `untrusted-json`, `printable-url`, `cache`, `fetch-failure`, `local-packages`, `verify`;
- the release channel against a recorded `ReleaseGet` (https only, redirect bound and checks, deadline, size limit);
- `args.rs` against Node's messages (unknown option, missing value, a boolean given a value, a stray positional, an ambiguous value, last value wins);
- a `proptest` round trip of the YAML emitter: any JSON value emits, parses back with `yaml_to_json` to the same value;
- the PORTING.md section 2 rows the functions touch (number text in OpenAPI, UTF-16 order in diff and bundles, `walk/decimal.ts`).

## 5. Seam PRs

Two seam PRs, started at once and in parallel, both before any port lane. They share no file: seam T owns `scripts/oracle`, `fixtures/`, `scripts/rust` and the tables; seam R owns `crates/`, `Cargo.toml`, `deny.toml` and `xtask`.

### Seam T: the TypeScript oracle extension (`oracle-tools`, N3)

`scripts/oracle` only, with the cases and expected files of section 4: the writers per unit, the recorded calls of the CLI cases, the converted cases, `check` and `write` over them, `differences.schema.json`'s new outputs, the README section (its first commit, so seam R can check the shapes against it). It also gives `scripts/rust/tools-coverage.ts` a pair collector per unit (lint, diff, bundle, the recorded units, cli: each case run under the probe) and reruns it (section 6).

### Seam R: the Rust skeleton (`tools-seam`, N5)

Merges after seam T, rebased, with the oracle reading the real expected files (every case `NotPorted`).

- The ten crates of section 2, each with `Cargo.toml` (workspace lints and dependencies), `lib.rs`, an empty `trace.tsv`, `src/not_ported.rs` and the `allow`, `RULE_IDS = &[]` where section 2 says, and the entry functions below as stubs:

  ```rust
  // seampact-openapi
  pub fn emit_documents(ir: &ContractIr, options: &EmitterOptions) -> Result<EmitOutcome, OpenApiError>;
  pub fn parse_emitter_options(raw: Option<&JsonValue>) -> Result<ParsedEmitterOptions, OpenApiError>;
  pub fn merge_documents(inputs: &[MergeInput], options: &MergeOptions) -> Result<MergeOutcome, OpenApiError>;
  // seampact-diff-table
  pub fn diff_table_json() -> JsonValue; // DIFF_CODES and DIFF_TABLE, for the oracle
  // seampact-diff
  pub fn diff_contracts(before: &ContractIr, after: &ContractIr, options: &DiffOptions) -> Result<DiffResult, DiffError>;
  pub fn diff_contract_sets(before: &IndexMap<String, ContractIr>, after: &IndexMap<String, ContractIr>, options: &DiffOptions) -> Result<IndexMap<String, DiffResult>, DiffError>;
  pub fn format_diff_report(result: &DiffResult) -> Result<String, DiffError>;
  // seampact-lint
  pub fn run_lint(input: &RunLintInput<'_>) -> Result<Vec<Diagnostic>, LintError>;
  // seampact-bundle
  pub fn build_bundle(options: &BundleBuildOptions<'_>) -> Result<BundleBuildResult, BundleError>;
  pub fn verify_bundle(directory: &Utf8Path, integrity: Option<&str>, channel: BundleChannel) -> Result<BundleFetchResult, BundleError>;
  // seampact-bundle-fetch
  pub fn fetch_bundle(source: &BundleSource, options: &BundleFetchOptions<'_>) -> Result<BundleFetchResult, BundleFetchError>;
  pub fn compile_workspace_with_imports(options: &WorkspaceImportsOptions<'_>) -> Result<WorkspaceImportsResult, BundleFetchError>;
  // seampact-cli-config, seampact-editor-schemas: the four config readers and the two editor-schema
  // functions of section 4's recorded calls, with the TypeScript's parameters
  // seampact-cli
  pub fn run_command(argv: &[OsString], io: &mut dyn CliIo) -> Result<i32, CliError>;
  pub fn run_cli(argv: &[OsString], io: &mut dyn CliIo) -> i32; // maps NotPortedYet to cli.not-ported
  ```

  `EmitOutcome`, `MergeOutcome`, `DiffResult`, `BundleBuildResult`, `BundleFetchResult` and the option types are declared with the TypeScript's members; each brief that ports their producer fills them. An error enum per crate (section 1) adds environment variants only in `bundle` (I/O) and `bundle-fetch` (I/O, HTTPS, `git`).
- `seampact-target` ported whole (119 function lines and the `not-generated-fixes.ts` data): OpenAPI refuses through it from its first brief.
- The binary skeleton: `main.rs`, `CliIo` (stdout, stderr, the working directory, the environment), the problem printer (`cli-problem.ts`, `cli-io.ts`), `args.rs`, the dispatch of `run_command` with the usage text, `help`, the waiting flags, and `NotPortedYet` for every command; each command lane replaces its arm.
- The oracle: `seampact-oracle` gains `ToolSubject` and its answer types (section 4), the case readers, the comparisons and the manifest normalisation, and the plain-key rule in `yaml_to_json`; `seampact_cli::oracle` (feature `oracle`) implements the trait by calling the entry functions above; each lane owns the wiring module of its unit (`crates/cli/src/oracle/<unit>.rs`; the recorded units one module each under `recorded/`, `recorded.rs` only dispatching) and converts its types to JSON with `#[derive(Serialize)]` forms local to that module, or the type's own `to_json` when the CLI prints the same JSON; no hand-built `JsonObject` sequences. The `StubError` impl of a crate's error lives in that crate's wiring module; the crate's last brief removes its `NotPortedYet` variant and that impl. `cargo xtask oracle [<glob>] [--tool openapi|openapi-merge|lint|diff-table|diff|bundle|cli-config|editor-schemas|bundle-fetch|cli]` runs the tools beside the compiler; the gate's oracle step runs both; the verdict prints one line per tool: `<tool>: <n> cases, <m> match, <k> differ, <p> not ported`.
- `Cargo.toml` (workspace): the new crates, `saphyr = "=0.3.4"`, `ureq`, `rustls` (`ring`); `clap` and `tar` removed.
- `deny.toml`: `ring` allowed with the wrappers `rustls` and `rustls-webpki` only; it leaves the "C build, unmaintained" group, whose comment no longer names a C build. `aws-lc-sys` and `reqwest` stay banned, their reason reworded from "the compiler reads local files only" to "network and C builds: `seampact-bundle-fetch` is the one network crate, through `ureq` and `rustls` with `ring`".
- `PORTING.md` sections 4 and 9 already say so (this note's PR).

## 6. Coverage tables

- `scripts/rust/tools-coverage.ts` writes one TSV per crate in `docs/maintainers/rust-design/cli-and-tools/` (`<crate>.tsv`, the columns of passes.md section 6). It reuses `cutBriefs`, `coverageTable`, `pairsOf` and `CoverageProbe` of `pass-coverage.ts`; its crate list is section 2, its skips section 1.
- Rerun: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/tools-coverage.ts`.
- A pair is one run of a case's writer: an OpenAPI emit of a (fixture, api), a converted IR or a merge case; a lint of a fixture api; a diff, bundle or CLI case; the one `diff-table` case. A CLI case is also a pair of `bundle-fetch`, `cli-config` and `editor-schemas`: the whole run is measured, not only the recorded calls. Every table is cut from its pairs; the briefs of the pending crates were recut when seam T landed.

| Crate | Function lines | Skeleton (Rust lines, estimate) | Briefs | Lines per brief | Pairs comparable after each brief |
|---|---|---|---|---|---|
| `target` | 119 | 225 | in seam R | 119 | 304 of 354 reach it |
| `openapi` | 3,613 | 2,610 | 4 | 672 986 976 979 | 49 49 324 354 of 354 |
| `diff-table` | 71 (plus about 1,100 lines of table data) | 105 | 1 | 71 | no pair: its one case reads the table data |
| `diff` | 3,957 | 2,655 | 5 | 672 987 952 963 383 | 5 42 82 100 100 of 100 |
| `lint` | 548 | 690 | 1 | 548 | 332 of 332 |
| `bundle` | 1,516 | 1,395 | 2 | 986 530 | 6 6 of 6 |
| `bundle-fetch` | 685 | 675 | 1 | 685 | 21 of 21 |
| `cli-config` | 1,077 | 1,005 | 2 | 988 89 | 28 28 of 28 |
| `editor-schemas` | 246 | 345 | 1 | 246 | 4 of 4 |
| `cli` | 2,129 | 2,085 | 3 | 957 999 173 | 30 36 36 of 36 |

## 7. Briefs

Cut rule: passes.md section 7, applied by the script per crate. A brief names its functions with TypeScript line ranges (`rg '^<n>\t' docs/maintainers/rust-design/cli-and-tools/<crate>.tsv`, the "files under" and "name file.ts:a-b" shape of the context packs), the oracle command and the TypeScript test files of its files; for these it says "ledger from the converted cases", and the lane hand-ports only what section 4 lists.

### Brief conventions

- A brief ports every function of its files whose callees are all ported, whether or not a pair reaches it yet; only a function that reaches unported code is a stub. A function that cannot fail returns no `Result`.
- Trace: brief 1 of a crate writes a line for every function of every TypeScript file the crate's TSV lists. A stub is `<rust path>\t<ts>\tpending: brief <k>`; a function never ported is `-\t<ts>\tskip: <reason>`; `pending:` without a stub is `-\t<ts>\tpending: brief <k>`. The trace check fails on `pending:` in a crate without `src/not_ported.rs`, and, once a crate's trace has a line, on a file of its TSV with none.
- End of a crate: `rg 'NotPortedYet|not_ported_yet|allow\(dead_code|pending:' crates/<crate>` prints nothing, every TypeScript file of the crate's TSV has its lines, the oracle reports 0 not ported for its tools, and the wiring's `NotPortedYet` handling for the crate (its `StubError` impl) is gone.
- `# Errors` sections name the `Internal` causes only; `NotPortedYet` is never documented per function.
- Tests: section 4's hand-ported list and the PORTING.md section 2 edge rows only. A behaviour the crate's oracle pairs reach at crate end gets no unit test, even while those pairs are still not ported. The YAML `proptest` round trip lands with openapi brief 2.

| Unit | Brief | Files (under the crate's TypeScript directory) | Oracle |
|---|---|---|---|
| `openapi` | 1 | skeleton; the spine: `documents`, `emit-context`, `schemas`, `responses`, `parameters`, `security`, `templates`, `bodies`, `serialize` | `cargo xtask oracle --tool openapi` |
| | 2-3 | the rest of `schemas`, `responses`, `bodies`, `paging`, `rights`, `examples`, `errors`, `operation-marks`, `ir-text` | as brief 1 |
| | 4 | `emitter-options`, `extension-names`, `drift`, `merge/` and what no pair reaches; replaces the placeholder `ApiSource` from `merged-document.ts` first | `--tool openapi`, `--tool openapi-merge` |
| `diff-table` | 1 | `diff-codes`, `result`, `options`, `table/` (data whole) | `--tool diff-table` |
| `diff` | 1 | skeleton; `diff-contracts`, `walk/walk`, `context`, `sink`, `api`, `operations`; a test that every definition name passed to `compare_members` is a `MEMBER_ROWS` key | `--tool diff` |
| | 2-4 | `walk/operations`, `type-use`, `declarations`, `catalogue`, `access`, `behaviour`, `reach`, `same-wire`, `refusals`, `maturity`, `decimal` | `--tool diff` |
| | 5 | `gate/`, `deprecation/`, `report/`, `walk/json` | `--tool diff` |
| `lint` | 1 | skeleton and every function | `--tool lint` |
| `bundle` | 1 | skeleton; `spec/src/bundle`, `contents`, `integrity`, `ustar`, `tarball-write`, `build`, `write`, `untrusted-json`, `manifest-read`, `ir-check`, the first half of `tarball-read` | `--tool bundle`, the vectors test |
| | 2 | the rest of `tarball-read`, `verify`, `local-packages`, `fetch-package.ts#installedPackageDirectory` | as brief 1 |
| `bundle-fetch` | 1 | skeleton and every function | `--tool bundle-fetch` (package and git cases), the `ReleaseGet` tests |
| `cli-config` | 1 | skeleton; `config-file`, `config-waits`, `key-path`, `path-containment`, `find-root-config`, `resolved-source`, `maven-source`, `read-app-config`, `read-root-config` | `--tool cli-config` |
| | 2 | `read-workspace-configs`, `read-run-config`, and `artefact-switches.ts#isFrameworkRouteCheckOff`, `#frameworkRoutesSwitchOf`, `document-plan.ts#openApiApiNames` | `--tool cli-config` |
| `editor-schemas` | 1 | skeleton and every function | `--tool editor-schemas` |
| `cli` | 1 | `run-cli`, `cli-io`, `cli-problem`, `error-code`, `is-record`, `symbolic-link`, `step` (types only), `config-location`, `workspace-api-names`, `api-refs`, `local-bundle`, `compile-sources`, `compile-command` | `--tool cli` |
| | 2 | `lint-command`, `diff-baseline`, `diff-command`, `bundle-command`, `contract-position`, `explain-view`, `explain-command`, `modelines`, `git-ignore`, `init-starter`, start of `init-command` | `--tool cli` |
| | 3 | the rest of `init-command` | `--tool cli` |

Twenty briefs over nine units, plus `seampact-target` in seam R. Every pending row is re-cut by seam T's rerun; the TSV is authoritative over this table.

## 8. Wave plan

At most four cargo lanes at once; one PR per brief; port lanes N2 (Sonnet medium), N3 for `bundle-fetch` (network, processes, the cache) and `cli` brief 1 (dispatch and the problem printer every command shares).

- **Wave 0**: seam T (N3) and seam R (N5) in parallel; seam R merges second.
- **Wave 1**: `openapi` (four briefs in a row, the longest chain), `diff-table`, `bundle`, `lint`. An Opus pattern review after the first merged brief that ports bodies (`lint` or `openapi` brief 1); its findings amend this note before the next briefs.
- **Wave 2**, as lanes free up: `diff` (after `diff-table`; five briefs), `bundle-fetch` (after `bundle`), `cli-config`, `editor-schemas` (after `cli-config` brief 1).
- **Wave 3**: `cli` brief 1 (after `cli-config`, `bundle-fetch` and `editor-schemas`: `compile` reaches all three), then brief 2 (after `lint`, `diff` and `bundle`), then brief 3.
- A lane rebases on `feat/rust-core` between briefs and reruns the whole oracle, compiler and tools.

## 9. PORTING.md and docs

- PORTING.md section 4: the tool outputs and `--tool` (this PR). Section 9: `clap` and `tar` leave the list; `saphyr` (emitter, pinned with the parser), `ureq` and `rustls` with `ring` join it; `webpki-roots`, `git2`, `gix` and `aws-lc-rs` are avoided (this PR).
- [ADR 0031](../../adr/0031-rust-core.md) "Bytes that change once": the bundle manifest's `compiler` member (section 2).
- [rust-rewrite.md](../rust-rewrite.md): "Order" item 2 listed the generator writer as a seam before the layers; it is layer 3.3's seam (this PR). "How the port is checked" now names the tool outputs.

## Spike evidence

A scratch cargo project on the repository toolchain (1.99.1), deleted after the note; the OpenAPI documents dumped by the TypeScript emitter from every `fixtures/expected/**/ir/*.json` (318 documents, 8 apis refused).

| Check | Result |
|---|---|
| `saphyr` 0.4.0 | depends on `saphyr-parser` 0.4.0: a second parser version beside the pinned 0.3.4 |
| `saphyr` 0.3.4 emitter, numbers as `Representation(token, Plain)`, `multiline(true)` | 318 of 318 documents parse back to the TypeScript document's value (the two numbers the spike's `f64` comparison flagged, `9223372036854776000` and `0.00001`, are emitted as the same tokens); 72 byte-identical; first difference: `pattern: "^(?:path\|query\|header\|body)$"` quoted where the `yaml` package writes it plain; 5.25 MB in 0.52 s (release) |
| clap 4.6.7 against `util.parseArgs` (strict) | unknown option: `error: unexpected argument '--bogus' found` and usage against `Unknown option '--bogus'`; missing value, boolean with a value, stray positional, `-x`, ambiguous value: all differ; `--out=a --out=b`: clap refuses, Node keeps `b` |
| `flate2` 1.1.11, level 9, mtime 0, OS 255 | 995 bytes against Node `zlib` level 9's 991, same 10-byte header; `miniz_oxide` and `zlib-rs` give the same 995; `GzDecoder` reads Node's stream |
| `ureq` 3.5.2 + `rustls` 0.23.46, x86_64 musl | `ring` 0.17.14: fails without a musl C compiler, builds with `CC_x86_64_unknown_linux_musl=gcc` (static-pie, 3.4 MB spike binary); `aws-lc-sys` 0.47: fails the same way; `rustls-graviola` 0.4.0: builds with no C compiler (4.7 MB) |
| The musl binaries against a loopback HTTPS server (throwaway CA in `SSL_CERT_FILE`, platform verifier) | `ring` and `graviola`: 200 with the body; a relative redirect followed; a redirect to `http:` refused by `https_only`; without the CA: `invalid peer certificate: UnknownIssuer`; `https://github.com` through the OS store: 200 |
| `cargo deny` (the repository's `deny.toml`) on the spike | licences pass; `ring` and `aws-lc-sys` are banned by name |
