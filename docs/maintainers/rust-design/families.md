# Rust design: the generator families and the shared planning

Layer 3.4 of the 2.0.0 port ([rust-rewrite.md](../rust-rewrite.md), "Order"): every first-party generator, the shared planning crate `seampact-plan`, and how families share code so that a new framework or language does not mean a new generator. It implements the contract of the [generators](generators.md) note, sections 2 and 3, and reuses the brief and coverage conventions of the [passes](passes.md) note, sections 6 and 7. A lane uses these shapes as given; a gap goes to the lead. Evidence for the choices that depend on Rust or crate behaviour is in "Spike evidence". Line counts are TypeScript function lines from the tables of `families/` unless a row says otherwise.

## 1. Scope

Two phases, in this order; each family follows the one it links to or imports.

| Phase | Family | Library crate | Target crates (modules of the library in brackets) | Function lines |
|---|---|---|---|---|
| TypeScript | ts (the reference) | `family-typescript` (81) | `gen-ts` (949) | 1,030 |
| | validators | `family-validators` (1,000) | `gen-zod` (226), `gen-yup` (321), `gen-class-validator` (556) | 2,103 |
| | node-server | `family-node-server` (3,337 with its two modules) | `gen-fastify` (256), `gen-nestjs` (358), `gen-nextjs` (89), `gen-adonis` (225), `gen-msw` (556), [hono], [express] | 4,821 |
| | fetch-client | `family-fetch-client` (850 with its module) | `gen-fetch` (297), [axios] | 1,147 |
| | front-queries | `family-front-queries` (1,027) | `gen-react` (922), `gen-vue` (561), `gen-angular` (587) | 3,097 |
| Code model | the code model | `code-model` | none | new code |
| | php | `family-php` (3,560 non-blank) | `gen-laravel` (1,280), `gen-symfony` (1,744), `gen-api-platform` (419) | 7,003 non-blank |
| | python | `family-python` (2,537), `family-django` (496) | `gen-fastapi` (518), `gen-drf` (1,285), `gen-ninja` (355) | 5,191 non-blank |
| | jvm | none | `gen-spring-boot` (2,843 non-blank, Kotlin writing Java) | 2,843 non-blank |

- The TypeScript phase totals 12,232 function lines, the 34 of `seampact-plan` included. The code-model phase totals 15,037 non-blank lines of PHP, Python and Kotlin (`families/native.tsv`; runtime packages excluded: they stay in their language, like every runtime).
- **Order.** `ts` provides the `types` link every server and client case reads, `validators` the link every server reads, and `node-server` imports `validators` (9 imports). `fetch-client` provides the `client` link the fronts read. The code-model phase starts after the last TypeScript family. Inside it, PHP comes first: `family-php` holds the most complete copy of the shared planning (`KeptForms.php` 1,042 lines against 528 in Python and 397 in Kotlin).
- **First family.** `codegen-ts` is the reference. A later family copies its shape, not the probe's: the probe holds its metadata inline and switches instances (`UnsupportedKindSwitch`, `PROBES: [&dyn Generator; 3]`). Those are oracle devices, not patterns.
- **Waits, each refused by name.**

| Left out | Where it lands | Until then |
|---|---|---|
| A short id whose family is not built | its family's last brief | `config.target.not-built` (generators.md section 3) |
| The blank-line and width rules of ADR 0031 "Bytes that change once" | once per family after parity, one PR per language | Prettier's settings for TypeScript; the 1.x layout for the code-model languages |
| `exec` and the plan member on the wire | 2.0.0 feature after parity | `config.target.exec-not-available`; the plan is `Serialize` from its seam so the protocol needs no second shape |
| The `format` config key | 2.0.0 feature after parity | as generators.md section 1 |
| The runtimes (`@seampact/server-runtime`, the front runtime, the PHP, Python and Spring runtimes) | not ported: generated code imports them | unchanged packages |
| The template packs (`packages/packs/*`) | not generators: the compiler reads them (layer 3.1) | unchanged |
| The native CLIs' own commands (Gradle and Maven plugins, Composer and Python entry points) | layer 3.5, the launchers | unchanged |

## 2. `seampact-plan`

**What it plans.** The language-neutral half of every family, computed once per entry and api by the run planning, never by a family:

- **Kept and refused forms.** Each planned item is `Kept(<item>)` or `Refused(Vec<Refusal>)` at the place the TypeScript computes it. The refusals are stored in the TypeScript's walk order, so a family collecting them in its own walk keeps the refusal order the oracle compares.
- **Routes.** Route order, path segments, and the segments a router cannot read. Each router's syntax is data in the target's capabilities (`RouterSyntax`: parameter form, what it refuses). This replaces `node-server/route-order.ts` and `path-segment-refusals.ts`, and the routes half of `RouteHelpers.php` and `route_helpers.py`.
- **Headers.** Identity, fingerprint, response and client-filled headers.
- **Paging.** The paging entry, the success reader's page facts, the next-page rule.
- **Validation rules.** `validators/type-plan`, `schema-plan`, `operation-input-plan`, `validators-plan`, `rules-option`, `integer-step` and `wire-name-check`: what every validator library checks, whatever its syntax.
- **Queries.** `front-queries/query-plan`.
- **Shared target options.** Typed values with `Deserialize` (`ResponsesMode`, `FrameworkEtagMode`, `CompressionOption`, ...). Each family's `Options` names the fields it takes, typed with them. Options are shared field by field, never through `#[serde(flatten)]`: flatten loses the pointer and turns an unknown key into `options.invalid` (spike).
- **The four language-neutral `codegen-core` helpers**: `client-filled-headers`, `query-list-wire`, `not-generated-forms`, and `mounted-base-paths`, which moves out of `crates/generate/src/mounted_base_paths.rs` (a family cannot reach `seampact-generate`).

**Where each file goes.** The split above is read from the file headers. Each library's plan seam (section 8) confirms it against the bodies and moves those files to `plan` in `FAMILY_CRATES`. A file that prints TypeScript stays in its library: `route-table`, `boundary-files`, `server-types`, the query and fetch modules, `layout`, `module-source`, and so on.

**Shape and member.** `GenerateRequest` lives in `seampact-target`, and `seampact-plan` needs `Refusal` and `IrLocation` from it. So the plan's data types live in `seampact_target::plan` and its functions in `seampact-plan`, which depends on `target`. Nothing cycles.

```rust
// seampact_target::plan: data only, Serialize (protocol 1), every struct #[non_exhaustive].
pub struct PlanCapabilities {            // a &'static field of TargetMetadata: `plan: Option<&'static PlanCapabilities>`
    pub routes: Option<RouterSyntax>,
    pub validation: Option<ValidationCapabilities>,
    pub queries: Option<QueryCapabilities>,
    pub client: Option<ClientCapabilities>,
    pub kept_forms: &'static [KeptFormSupport],
}
pub struct ApiPlan { pub operations: Vec<OperationPlan>, /* one member per part, Option when its capability is absent */ }
pub enum Planned<Item> { Kept(Item), Refused(Vec<Refusal>) }

// seampact_plan
pub fn plan_api(ir: &ContractIr, capabilities: &PlanCapabilities, mount: &str) -> ApiPlan;
```

- `seampact-generate` calls `plan_api` for an entry whose metadata has `plan`. The request carries the result as `plan: Option<&'run ApiPlan>`, and `GenerateInput.plan` is present exactly when the metadata has `plan`. A family reads it; it never calls `seampact-plan` from `generate`.
- `plan_api` returns no `Result`: a refusal is planned data, and a bug in it is a `TargetFailure::Internal` that the family raises where the TypeScript threw.
- **Built.** The skeleton and the four helpers come with the first family (seam F). Each part's types come in the plan seam of the library that first reads it (validators PV, node-server PN, fetch-client PF, front-queries PQ). Each part's bodies come in that library's first briefs. "Built before the second family" holds: seam F lands before `validators`.

## 3. The sharing criterion

**Criterion** (code lines as measured here: Rust lines without blanks, docs or inline tests):

- A new Node server, front framework or client library is one framework-table row, plus under about 150 code lines of its own, plus its line in `FIRST_PARTY_TARGETS`, the registry and the compatibility data.
- A new PHP-, Python- or Java-like language is its rules in `code-model` (a `LanguageRules` table, naming rules, type mapping), plus one row of the writer's extension table. It needs no printer and no planning of its own.

**How TypeScript shares: family libraries, not a code model.** TypeScript output is source text built from string parts, then formatted by oxc (ADR 0031 "Formatting"). A TypeScript code model would duplicate oxc's printer. The libraries already carry the TypeScript sharing, as shown by the measured TS sizes of `packages/targets` (non-test lines):

| Kind | Library | Thin targets on it | Heavy targets on it | Verdict |
|---|---|---|---|---|
| Node server | `node-server` 4,307 | hono 70, express 73, nextjs 148 | fastify 578, nestjs 514, adonis 421 (own validator libraries and docs modules), msw 830 | the criterion holds; the heavy ones carry their own validator or docs adapter |
| Client | `fetch-client` 1,073 | axios 82 | fetch 512 | holds once axios's imports of `codegen-fetch` move into the library |
| Front | `front-queries` 1,549 | none | react 1,407, vue 948, angular 1,371 | fails today: each repeats `generate.ts` (202, 164, 161) and one module per query library |

The fronts get two changes:

- **The front skeleton.** `generate.ts` (module list, `librarySources`, `refuseUnsupportedArtefacts`) becomes one `FrontFramework` table in `family-front-queries`: module names, the hook or composable prefix, the client directive, and the query libraries the framework offers. Brief Q1 ports the shared shape, and Q2 and Q3 port only what differs.
- **One adapter per query library and framework.** TanStack on React is 85 + 30 lines, on Vue 84 + 35. On paper, a new framework that offers TanStack is the table row plus about 120 TS lines, about 170 code lines at the 2 times ratio (section 7): 20 over. **Accepted:** the hook syntax differs per framework (React hooks, Vue refs), so it is code, not data. SWR, RTK and Pinia Colada are framework-specific libraries and cost what they cost.

**Paper cost 1: a fictional Node server `koa`**, against today's crates. The row and statics are spike-measured (`FrameworkRow` literal, `static KOA_FRAMEWORK`, `static KOA`); the rest is estimated.

| Line | Where | Code lines |
|---|---|---|
| framework row (`id`, compatibility package, docs-off fix, native docs on or off) | `family-node-server/src/frameworks/koa.rs` | 6 |
| `static KOA_FRAMEWORK: NodeFramework` (metadata from `node_server_metadata(&ROW)`, module name, module source fn) | same | 9 |
| `pub static KOA: NodeServer = NodeServer { framework: &KOA_FRAMEWORK }` | same | 1 |
| the framework module source (hono's `honoModuleSource`: 40 TS lines, mostly literal lines) | same | about 60 |
| `first_party("koa", &["@seampact/codegen-koa"])` | `crates/target/src/registry.rs` | 1 |
| `&KOA` in `registry()` | `crates/generators/src/lib.rs` | 1 |
| compatibility record | `spec/src/compatibility` data (JSON, shared with 1.x) | 0 Rust |
| **Total** | | **about 78**, under 150 |

No `Cargo.toml` changes: a module of a library adds no crate. A framework with its own validator or docs adapter (fastify, nestjs, adonis) is a `gen-<id>` crate. Rule: a framework whose own TS, `target.ts` excluded (it becomes the row), is under 75 lines (150 code lines) is a module of its library; otherwise it is a crate.

**Paper cost 2: a fictional code-model language** (C#-like, for an ASP.NET target):

| Line | Where | Code lines |
|---|---|---|
| `LanguageRules` const: indent, width, block open and close, terminator, comment, string-literal escapes, null test, visibility keywords, attribute syntax | `code-model/src/languages/csharp.rs` | about 45 (the spike's statement rules take 5 fields; expressions about 15 more) |
| naming rules: reserved words (data), case of types, members and files | same | about 30 |
| type mapping: each IR type use to a language type (PHP's is `PhpType.php` + `PhpTypes.php`, 160 lines) | same | about 150 |
| extension row (`.cs`, `// <header>`, passed through) | `crates/writer/src/finish_files.rs` | 1 |
| printer, planning, kept forms, refusals | none: `code-model` and `seampact-plan` | 0 |
| **Total** | | **about 226**, no printer and no planning |

Then a framework on that language is a `gen-<id>` crate. It prints through the code model and sizes like `gen-laravel`.

**Measured duplication that the code-model phase removes.** The planning repeated in each language today:

| Concept | PHP | Python | Kotlin |
|---|---|---|---|
| kept forms | `KeptForms.php` 1,042 | `kept_forms.py` 528 | `KeptForms.kt` 397 |
| response headers | `ResponseHeaderEntries.php` 195 | `response_header_forms.py` | `ResponseHeaderEntries.kt` 138 |
| handler forms | `HandlerForms.php` 137 | `handler_forms.py` | `HandlerForms.kt` 152 |
| route helpers, sort keys, redacted members, refusals | 149 + 25 + 67 + 117 | their twins | in `SpringRegistration.kt` |

- In PHP, the planning files are 1,732 of 4,271 lines (41 percent). They are ported once, into `seampact-plan`; the Python and Kotlin twins get `skip:` trace lines that point to it.
- The printers (`PhpClassFile.php` 108, `printer.py` 196, `source_lines.py`, `JavaLayout.kt` 247) become `code-model` and its three `LanguageRules`.

**Metadata fits the budget** through const constructors in `seampact-target` and a `const fn` per library:

- `ArtefactDeclaration::on(id)`, `ArtefactDeclaration::off(id)`, `.needing(&[ids], MissingNeed)`, `LinkNeed::listed(&[styles])`, `LinkNeed::from_compatibility()`, `.optional(own_library)`.
- Each library has a `const fn <library>_metadata(row: &FrameworkRow) -> TargetMetadata`.
- The probe's 46 lines of metadata become 6 lines per row.
- An artefact list built in a `const fn` must be a named `const` slice that the function selects. A slice literal of `const fn` calls is a temporary, not a `'static` (spike, `E0716`).

## 4. Crates

| Crate | Directory | Holds | Depends on (beyond `target`, `ir`, `json`, `js`, `naming`) |
|---|---|---|---|
| `seampact-plan` | `crates/plan` | `plan_api` and the parts of section 2; the four helpers; `mounted_base_paths` (moved) | none |
| `seampact-family-typescript` | `crates/family-typescript` | the TypeScript printing basics shared by at least two libraries: `planned-names` (`type_script_identifier`, `require_name`, `declared_type_identifier`), `api-index`, `property-key`, `module_specifier_literal` (section 5) | none |
| `seampact-family-<library>` | `crates/family-validators`, `family-node-server`, `family-fetch-client`, `family-front-queries` | the library's printing, its framework table, its adapter type (`NodeServer`, `FrontQueries`, ...), the modules of its thin frameworks, its `refusal_code` module | `plan`, `family-typescript`; `family-node-server` also `family-validators` |
| `seampact-gen-<id>` | `crates/gen-<id>` | a framework with code of its own; its row and `static` | its libraries |
| `seampact-code-model` | `crates/code-model` (code-model phase) | the tree (files, declarations, statements, expressions, type uses), `LanguageRules` for PHP, Python and Java, the printer with the ADR 0031 blank-line and width rules per language | none |
| `seampact-family-php`, `-python`, `-django` | `crates/family-*` | the language's printing over `code-model` | `plan`, `code-model` |

- **Direction.** The allow lists already work: `xtask/src/deps.rs` reads the `family-*` and `gen-*` directories and allows `target`, `ir`, `json`, `js`, `naming`, `plan` and any `family-*`. `code-model` joins that base list in the code-model seam. No family reaches `seampact-generate`, a pass crate, `cli` or `cli-config`. No `gen-*` reaches another `gen-*`: `codegen-axios` importing `codegen-fetch` becomes `family-fetch-client` holding both. `cargo tree -e normal` is the check, as now.
- **Edits outside a family's crates**, the whole list (`deps.rs` and the workspace `members = ["crates/*"]` need none):
  1. root `Cargo.toml` `[workspace.dependencies]`: one line per new crate;
  2. `crates/generators/Cargo.toml`: one line per crate the registry names;
  3. `crates/generators/src/lib.rs`: one `&STATIC` per target in `registry()`;
  4. `crates/generators` test `every_refusal_code_is_listed_once`: one `family::refusal_code::ALL` per crate (section 5);
  5. the compatibility data, for a target that has a record.

  A brief's checklist names these five. `config.target.not-built` stops by itself once the registry has the id.
- **`legacy_names` has one owner: `FIRST_PARTY_TARGETS`** (`seampact-target`). It lists every short id, built or not, and the lookup reads it already. `TargetMetadata.legacy_names` is removed. Its only reader, `crates/cli/src/oracle/generator_registry.rs`, reads `FIRST_PARTY_TARGETS` (a probe's package name is its id). A registry test requires each registered generator's id to be a `FIRST_PARTY_TARGETS` id or a probe's.
- **Module layout of a library**: `frameworks/<id>.rs` per row, one module per printed file kind, and `refusal_code.rs`, as `gen-ts` sets them.

## 5. Contract follow-ups

These signatures freeze in seam F, before `gen-ts`.

- **Request members** (review input 4).
  - `GenerateRequest`'s fields become private, so a member has one way to be set: `with_<member>(value)` taking the member's own type, `Option` included. The run planning passes an entry's `Option` as it is: `with_mount(entry.mount())`, `with_plan(plan.as_ref())`.
  - `GenerateInput` stays the readable view, with public fields and `#[non_exhaustive]`.
  - A new member costs four edits in two crates: the field and setter of the request, the field of the input, the default in the blanket impl, the run planning's call. The probe's `request_echo.rs` changes only when the oracle must see the member.
  - The 3.4 members: `plan` (section 2); metadata gains `plan: Option<&'static PlanCapabilities>`.
- **No `typescript` group.** Of the four members the review called Node-only, three serve native targets too: `mount` (7 PHP, 14 Python and 5 Kotlin files read it), the framework-route check (PHP, Python and Kotlin), native docs (Python, Kotlin) and the hook check (all three). Only `import_specifiers` is Node-only (no native file reads it). It stays one `Option` member, which a code-model family ignores. A group of one member would cost a type and buy nothing.
- **`parse_options` is a default method** (input 3): `type Options: DeserializeOwned;` and `fn parse_options(&self, raw: Option<&JsonValue>) -> Result<Self::Options, TargetFailure> { Ok(seampact_target::parse_options::<Self::Options>(raw)?) }`. A family overrides it only for cross-field checks.
- **`GeneratedFile::json(path: impl Into<String>, value: &impl Serialize) -> Result<GeneratedFile, TargetFailure>`** (input 5). It writes compact canonical JSON through `seampact_json`, and the writer lays it out (`indented_json`). A value that does not serialize (a non-string key, a non-finite number) is `TargetFailure::Internal`. No family writes JSON layout. The PHP, Python and Kotlin JSON outputs are checked against `indented_json` in the native oracle seam (generators.md section 3).
- **Refusal codes** (input 8).
  - Each family crate has `pub mod refusal_code` with one `pub const` per literal code and `pub const ALL: &[&str]`.
  - The form-derived codes stay `NotGeneratedForm` (`<form>.unsupported`, `seampact-target`), and the lookup codes stay `TargetLookupCode`.
  - `seampact-generators` has the unified-list test: it concatenates `seampact_target`'s codes, `NotGeneratedForm::ALL`, `TargetLookupCode::ALL` and every family's `ALL`, then requires each code to be unique and lowercase dotted. The troubleshooting tables (ADR 0031) read the same lists.
  - Measured: the TS family sources hold 21 distinct literal `code:` strings, or 50 counting templated and constant ones. Most refusals go through `refuseNotGeneratedYet` with a form, whose code `NotGeneratedForm` already has.
- **Internal-error arms** (input 14). A `throw new Error` in a family ports as `return Err(TargetFailure::Internal(..))` with the TypeScript's message. Measured: 27 `throw new Error` sites and 56 `throw` statements in the non-test family sources. The review's 97 counted a wider set; these tables are authoritative. At about 4 code lines each, that is about 220 lines, inside the 2 times budget.
- **`LinkLocation::Relative.path`** (input 13) is free text from `out`. A TypeScript family writes any module specifier through `family_typescript::module_specifier_literal(specifier) -> String` (the JSON string text, a valid JavaScript string literal), never through `format!` with quotes. A code-model family writes it as the code model's string-literal node, escaped by `LanguageRules`. The ADR sentence goes to the lead (section 10).
- **Reviewed shapes taken as given** (inputs 6 and 7, landing in a fix lane): `ArtefactSet::contains(ArtefactId)` and link kinds in declaration order.

### The layer 3.3 review inputs

| Input | Place |
|---|---|
| 1 const constructors and a `const fn` from a framework table | section 3, seam F |
| 2 budget at 2 times, code lines as measured here | section 7 |
| 3 `parse_options` default method | section 5, seam F |
| 4 request members, setters, the `typescript` group | section 5, seam F: private fields, one setter per member, no group |
| 5 `GeneratedFile::json` | section 5, seam F |
| 6 `ArtefactSet::contains(ArtefactId)`, 7 link kinds in declaration order | taken as given from the fix lane |
| 8 refusal codes | section 5: per-family `refusal_code` modules, the unified-list test in seam F |
| 9 the probe is not the reference | section 1 |
| 10 per-family edits outside the crate | section 4: five, named in each brief |
| 11 `legacy_names` | section 4: `FIRST_PARTY_TARGETS`, the metadata field removed in seam F |
| 12 probe cases and twins | section 6 |
| 13 `LinkLocation::Relative.path` | section 5, `module_specifier_literal`; the ADR sentence to the lead |
| 14 internal-error arms | section 5, measured |

## 6. The oracle

What exists: the `steps` CLI cases, the `generated` token comparison and its normalisations, manifest version 2 (seam G), the probes. What 3.4 adds:

- **Family cases.** A seam-O script, `scripts/oracle/family-cases.ts`, writes `fixtures/cli/family-<id>-<variant>/` from one table:
  - for each first-party target, a `steps` case per api of `fixtures/reference` (the `tasks*` apis): `generate`, then `check`;
  - its providers linked as a real app links them (servers: `ts` types and `zod` validators; fronts: `fetch` and `ts`);
  - one case per value of each enumerated option (react's query libraries, `rules`, `responses`, ...);
  - one case per refusal fixture of `fixtures/rules` that names the target's forms.

  The TS side records them; seam O reruns `family-coverage.ts` with pairs.
- **`use` strings on both sides.**
  - A case's config names the 1.x package. The TS harness links `packages/targets/codegen-*` as `<root>/node_modules/@seampact/codegen-*`.
  - Before each Rust `argv` step, the Rust harness rewrites every exact 1.x first-party string in the root's config files to its short id, through `FIRST_PARTY_TARGETS`.
  - Linking under the short id instead would shadow the real `zod`, `fastify`, `vue` or `express` package, which the compatibility check reads from `node_modules`.
  - The rewrite shifts columns on the `use` line only. A diagnostic on that line after the value needs a `differences.yaml` entry.
- **Probe cases and twins** stay for the run planning. A new probe case or TS twin is added only for a capability no first-party family covers (input 12). A probe case that a family case now covers is kept: it isolates the run planning.
- **The differential check** of the layer 3.2 correctness lens, reusable per family. Seam O commits it as `scripts/oracle/differential.ts`. It runs the TypeScript `runCli` (through `tool-modules.ts`) and the Rust binary with the same argv on a clean copy of the same project, and compares the exit code, stdout, stderr and every written file (the `generated` comparison for generated files). Each family's correctness lens runs it on `examples/*` and on the option matrix of the family's options type.
- **Code-model phase (seam NO).**
  - The 1.x native generators' outputs are recorded once, by their runtimes (`php`, `uv`, `gradle`, as their CI jobs run them), into `fixtures/expected/native/<id>/<case>/`.
  - `.php`, `.java` and `.kt` compare as token streams, whitespace aside. `.py` compares as Python tokens with INDENT and DEDENT, so wrapping inside brackets is free and indentation is kept.
  - The recorded trees are the TS side of those cases.

## 7. Budget

- The ratio is code lines as measured here (Rust without blanks, docs or inline tests) against TypeScript function lines. Layer 3.3 came in at writer 865/488 = 1.8, generate 3,469/1,530 = 2.3 and cli-config about 2.2, against 0.9 priced. Families are budgeted at **2 times**.
- TypeScript phase: 12,232 function lines, about 24,500 code lines.
- Code-model phase: 15,037 non-blank native lines. The ratio applies to the lines left after the planning is removed (about 30 percent across the three languages, from the planning table of section 3), so about 21,000 code lines before the printer is shared.
- The `Internal` arms are inside the ratio (section 5). Each brief's hand-back records its measured ratio. A family above 2.5 stops for the lead before its next brief.

## 8. Seam PRs, coverage tables and briefs

**Coverage.**

- `scripts/rust/family-coverage.ts` writes `families/<crate>.tsv` (columns of passes.md section 6, the file column relative to `packages/`) and `families/native.tsv` (crate, file, non-blank lines).
- It reuses `cutBriefs`, `coverageTable` and `listTypeScriptFunctionRanges`, and prints the throw and code counts per crate.
- No case runs a family yet, so every pair count is 0 and the cut follows source order. Seam O adds the pairs (`CoverageProbe` over the family cases) and reruns it, and the rerun's TSV wins over the tables below.
- `trace.ts` gains `FAMILY_TABLES_DIR` with its source root `packages` (seam O).
- Rerun: `node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts scripts/rust/family-coverage.ts`.

**Seam PRs.**

| Seam | Level | Holds | After |
|---|---|---|---|
| F, family contract (`family-seam`) | N5 | section 5 in `seampact-target` (private request fields, setters, `plan` member and `PlanCapabilities`, the const constructors, `parse_options` default, `GeneratedFile::json`, `legacy_names` removed); `seampact-plan` with its skeleton and the four helpers whole (34 lines, `mounted_base_paths` moved); `family-typescript` whole (81 lines and `module_specifier_literal`); the unified-list test; the per-family edit checklist in `crates/generators/README.md` | the review-input fix lane |
| O, family oracle (`family-oracle`) | N3 | the family cases and their script, the package linking, the Rust `use` rewrite, `differential.ts`, `FAMILY_TABLES_DIR`, the coverage rerun with pairs | wave 0, beside F |
| PV, PN, PF, PQ, the plan parts | N5, small | the part's types in `seampact_target::plan`, its `PlanCapabilities` member, `plan_api`'s call, the final file split of the library | before the library's first brief |
| NC, code model (`code-model-seam`) | N5 | `code-model` (tree, printer, `LanguageRules` for PHP, Python and Java), `code-model` in the `deps` base list, the native plan parts | after the last TS brief |
| NO, native oracle | N3 | section 6, code-model phase | beside NC |

**Briefs**, in gain order, about 1,000 function lines each. A brief names its rows with `rg '^<n>\t' docs/maintainers/rust-design/families/<crate>.tsv`, in the "files under" and "name file.ts:a-b" shape of `context-pack.py`. It also names the oracle command `cargo xtask oracle --tool cli 'family-<id>-*'`, the TS tests of its files, the edit checklist of section 4, and the plan part it reads.

| Brief | Crates (TSV briefs) | Function lines | Reached by |
|---|---|---|---|
| T1 | `gen-ts` | 949 | every `family-ts-*` case; the `types` link of every later case |
| V1 | `family-validators` | 1,000 | after PV: the validators plan and printing |
| V2 | `gen-zod`, `gen-yup`, `gen-class-validator` | 1,103 | `family-zod-*`, `-yup-*`, `-class-validator-*` |
| N1, N2, N3, N4 | `family-node-server` briefs 1 to 4, after PN | 937, 987, 947, 466 | N4 ends with the hono and express modules: `family-hono-*`, `family-express-*` |
| S1 | `gen-fastify`, `gen-nestjs`, `gen-nextjs`, `gen-adonis` | 928 | their cases |
| S2 | `gen-msw` | 556 | `family-msw-*` |
| F1 | `family-fetch-client` (with axios), `gen-fetch`, after PF | 1,147 | `family-fetch-*`, `family-axios-*`; the `client` link |
| Q1 | `family-front-queries`, with the `FrontFramework` table, after PQ | 1,027 | none alone |
| Q2 | `gen-react` | 922 | `family-react-*` |
| Q3 | `gen-vue`, `gen-angular` | 1,148 | `family-vue-*`, `family-angular-*` |

That is 13 TypeScript briefs. The code-model phase is cut by seam NC from `native.tsv`, with the planning rows removed: about 12 briefs (PHP 4, Laravel and Symfony 3, API Platform with Django 1, Python 2, FastAPI, DRF and Ninja 2, Spring Boot 3, merged where under 500 lines).

## 9. Wave plan

At most four cargo lanes at once; one PR per brief; port lanes N2 (orchestrator.md "Rust port").

- **Wave 0**: seam F (N5) and seam O (N3) in parallel.
- **Wave 1**: T1. Then an Opus pattern review of T1, before any other family brief: it is the reference to copy, and its findings amend this note.
- **Wave 2**: PV, then V1 and V2 in parallel (V2's adapters stub on V1's signatures from PV); PN beside them.
- **Wave 3**: N1 to N4 in order, PF beside them, then F1 beside N4.
- **Wave 4**: S1 and S2 in parallel, PQ, then Q1, then Q2 and Q3 in parallel.
- **Layer review of the TypeScript phase**; then NC and NO, then the code-model briefs in the order of section 1, with at most four at once; **layer review** at the end.
- A lane rebases on `feat/rust-core` between briefs and reruns the whole oracle.

## 10. PORTING.md and docs

- PORTING.md section 4: the family cases and the `use` rewrite. Section 8: the gate's `deps` and `release` steps, which it ran already and the section did not list (this PR).
- [generators](generators.md) section 9: its checklist is decided here (this PR).
- [rust-rewrite.md](../rust-rewrite.md) "Generators": `seampact-plan` holds the planning data's functions; its types live in `seampact-target` (this PR).
- ADR 0031 "External generators" (lead change): one sentence. A link location path is free text from the app config, and a generator writes it only as an escaped string literal.
- ADR 0031 "Bytes that change once" (lead change): the 1.x PHP, Python and Kotlin printers are replaced by one printer, compared as tokens until the per-language formatting PR.

## Spike evidence

A scratch cargo project on the repository toolchain (1.99.1), with path dependencies on `seampact-target`, `seampact-ir` and `seampact-json` and the repository's `Cargo.lock`, built with two jobs; deleted after the note.

| Check | Result |
|---|---|
| A `const fn node_server_metadata(&FrameworkRow) -> TargetMetadata` with `..TargetMetadata::BASE`, called in a `static` initializer | compiles; the registry's `&dyn Generator` over `static KOA: NodeServer { framework: &KOA_FRAMEWORK }` reads id `koa`, its artefacts and `CompatibilityKey::Server` |
| An artefact slice literal of `const fn` calls inside that `const fn` | `E0716` (temporary dropped while borrowed); a named `const` slice chosen by the function compiles |
| Const constructors `on`, `off`, `needing`, `from_compatibility` | `const fn` over `ArtefactDeclaration` and `LinkNeed` as they are; `Option` matched in a `const fn` |
| `#[serde(flatten)]` of a shared options struct with `deny_unknown_fields` on both, through `seampact_target::parse_options` | an unknown key is `options.invalid` at pointer `""` instead of `options.unknown` at `/nope`; an out-of-range integer loses its pointer (`""` instead of `/thresholdBytes`); the plain struct keeps both |
| A code-model `if` with a `return` printed by one function under three `LanguageRules` (5 fields) | PHP `if (...) {` with 4 spaces and `}`, Python `if ...:` with no close, Java with 2 spaces; the condition's text is language-specific, so expressions (null test, variables) need model nodes, not rules alone |
