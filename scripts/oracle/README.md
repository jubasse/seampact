Expected outputs of every fixture and the differential checks of the Rust port: the oracle CLI (scripts/oracle).

The TS compiler is the oracle of the 2.0.0 Rust port (`docs/maintainers/rust-rewrite.md`, "How the port is checked"). While it lives, `check` keeps the committed expected outputs current; the Rust harness compares its own outputs with the same files.

## Commands

Run from the repository root; the CLI relaunches itself with the flags the compiler's sources need.

- `node scripts/oracle/cli.ts write [<glob>]`: compile the fixtures and rewrite `fixtures/expected/<fixture path>/`.
- `node scripts/oracle/cli.ts check [<glob>]`: compile and compare; prints `oracle: <n> fixtures, <m> match, <k> differ`, then the first mismatch (fixture, file, JSON pointer, 3 lines of context each side). Exit 1 on a mismatch.
- `cargo xtask oracle [<glob>] [--half <name>]`: the Rust harness (`crates/oracle`) compares the Rust compiler's outputs with the same files under the intended differences below, prints its own verdict (counts, the first mismatch, the problems) and exits 1 on a failure; `--half` compares one pass half only.
- `node scripts/oracle/cli.ts coverage`: every diagnostic rule id the compiler can emit against the expected `diagnostics.json` files; lists the uncovered ids and writes `fixtures/expected/rule-coverage.json` (`{ "<rule id>": ["<fixture path>", ...] }`, `[]` when uncovered). The ids are read from the compiler sources (`rule-ids.ts`): `XRule` union types, `rule: "..."` literals and full `"seampact/<stage>/<rule>"` literals; the finalize stage's run-time schema and invariant rules are not listed. Coverage fails (exit 1) when an expected `diagnostics.json` holds a rule id no source declares. `check` on the whole tree also reports expected trees of no fixture and keys of `excluded.json` naming no fixture.

A glob matches fixture paths: `**` any path, `*` one segment, a path without glob characters also matches what is below it. A glob that matches no fixture is a usage error (exit 2).

## Fixtures and expected files

A fixture is a directory under `fixtures/` holding `workspace.yaml` or `api.yaml` (`fixtures/expected/` is left out), sorted by UTF-16 code units. `excluded.json` lists the fixtures the oracle cannot compile alone (`fixtures`) and those whose halves it does not write (`halves`), each with a one-line reason.

Per fixture, under `fixtures/expected/<fixture path>/`:

- `diagnostics.json`: `{ "workspace": [...], "apis": [{ "api", "diagnostics": [...] }] }`, in the order the compiler returns them;
- `ir/<api>.json` and `source-map/<api>.json`: the bytes the IR writer emits (those of `seampact compile --out`);
- `halves/<api>/<NN>-<half>.json`: what each pass half wrote, in run order (`NN` is the position in `pipelineHalves`; a half that did not run has no file), in the convention of `packages/core/compiler/src/pipeline/draft-fixture.ts`;
- `halves/<api>/<NN>-<half>.diagnostics.json`: the diagnostics that half reported, sorted as `diagnostics.json` is; written only when the half reported at least one, so an absent file next to a delta means `[]`;
- `schema-calls/<api>.json`: `[{ "method", "args": [...], "answer"? }]`, the calls the halves after `tree.schemas` made to the schema service (`typeUse`, `checkExample`, `queryWire`, `checkTextExample`), deduplicated by method and arguments in the order of the first call; `answer` is absent when the service answered `undefined`; written only when the api has at least one call, so an absent file means no call. One question never has two answers: the writer throws if it does. Four `checkTextExample` calls are recorded, all from converted fixtures.

`fixtures/converted/<half>/<test file stem>/<case>/` holds fixtures converted from the unit tests of the pass halves: one fixture per distinct contract that a test compiled and whose half delta or diagnostics are not empty, with the whole expected tree like every other fixture. They are compiled and compared as any fixture, so `write` and `check` cover them.

## Tool outputs

Beside the compiler, the oracle writes the expected outputs of the tools of layer 3.2 (`docs/maintainers/rust-design/cli-and-tools.md`, section 4). `write` and `check` cover them with the fixtures; a glob matches a case path as it matches a fixture path. A unit directory sits next to a case's own expected entries under `fixtures/expected/<case path>/`, so a fixture never nests below a directory named `openapi`, `openapi-merge`, `lint`, `diff`, `bundle`, `cli`, `cli-config`, `editor-schemas` or `bundle-fetch`.

### Cases

| Unit | Case | Expected, under `fixtures/expected/<case path>/` |
|---|---|---|
| `openapi` | every fixture api with an IR, default options (a fixture holding `openapi.options.json` uses it for all its apis); a converted case `fixtures/converted/openapi/<test stem>/<case>/` holding `ir.json` (the IR the test emitted) and an optional `openapi.options.json`; the api is `ir.json`'s `api.name` | `openapi/<api>/<document>.yaml`, or `openapi/<api>.refusals.json` |
| `openapi-merge` | `fixtures/openapi-merge/<case>/merge.json` | `openapi-merge/merged.yaml` or `openapi-merge/refusals.json` |
| `lint` | every fixture api that compiles | `lint/<api>.json`, only when non-empty |
| `diff-table` | none, one global case | `fixtures/expected/diff-table.json` |
| `diff` | `fixtures/diff/<case>/` and `fixtures/converted/diff/<test stem>/<case>/`: `before/`, `after/` (each a fixture, or a single `before.ir.json` / `after.ir.json` for an api a test built as an IR) and an optional `diff.options.json` | `diff/result.json`, `diff/report.txt` |
| `bundle` | `fixtures/bundle/<case>/`: `bundle.json`, and the workspace beside it or named by `workspace` (a path relative to the case, outside it too) | `bundle/files.json`, `bundle/manifest.json`, `bundle/integrity.txt`, `bundle/ustar.json`, or `bundle/refusals.json` |
| `cli` | `fixtures/cli/<case>/` and `fixtures/converted/cli/<test stem>/<case>/`: `cli.json` and `tree/` (the project); discovery stops below a `cli.json` | `cli/transcript.json` |
| `cli-config`, `editor-schemas`, `bundle-fetch` | the calls a CLI case makes, recorded while the command runs | `<unit>/<NN>-<function>.json` under the CLI case |

Case files:

- `openapi.options.json`: the raw emitter options `{ "extensions"?, "reasons"?, "inputSchemas"?, "servers"? }`; absent means the defaults. A raw value `parseEmitterOptions` refuses is a case: the expected file is the refusals.
- `merge.json`: `{ "name": string, "prefix": { "<api>": string }, "emitter"?: <raw emitter options>, "inputs": [{ "fixture": "<fixture path under fixtures/>", "api": string, "document"?: string, "operations"?: [string] }] }`. An input's IR is the expected `ir/<api>.json` of that fixture, kept to the listed operation ids when `operations` is present. `emitter` goes through `parseEmitterOptions`; a refusal there is the case's refusals.
- `diff.options.json`: `{ "today": "YYYY-MM-DD", "gate"?, "exempt"? }` in the TypeScript's member names; absent means `{ "today": "2026-01-01" }`.
- `bundle.json`: `{ "workspace"?: "<workspace file relative to the case>", "name"?: string, "version"?: string }`; `workspace.yaml` (else `api.yaml`) of the case by default; the reader root is the directory of that file; an absent name or version comes from the case's `package.json`.
- `cli.json`: `{ "argv": [string], "cwd"?: "<directory relative to tree/>", "env"?: { "SEAMPACT_CACHE_DIR"?: "<directory relative to the run root>", "SEAMPACT_ALLOW_LOCAL"?: string } }`. Any other variable name is refused. Absent, `SEAMPACT_CACHE_DIR` is `<root>/.cache`. The command runs with `today` fixed to `2026-01-01`. The second form, `steps`, is below ("Generate and check cases").
- `git-source/<tag>/` beside `tree/`: the harness builds `<root>/git-source.git`, a bare repository whose commits, in name order, each hold exactly one directory as their tree and are tagged with its name; the repository sits beside `tree/`'s content in the root, so a config in a subdirectory names it `../git-source.git` and runs with that `cwd`; the case's config names it `../git-source.git`. Needs `git` on the PATH.

`<root>` is a fresh copy of `tree/` (and `git-source.git`) in a temporary directory; it is written `<root>` in every expected text.

### Expected files

- `openapi/<api>/<document>.yaml`, `openapi-merge/merged.yaml`: the YAML text; `<document>` is the `api.documents` key, `default` for the one document of an api that declares none.
- `*refusals.json` (OpenAPI, merge): `[{ "code", "message", "fix", "operation"?, "member"?, "docs"? }]`, in emit order. `bundle/refusals.json`: the `BundleFailure` list as `buildBundle` returns it.
- `lint/<api>.json`: the diagnostics `runLint` gives (no plugins), each as one entry of `diagnostics.json`, in its order. `declared` and `locations` come from compiling the fixture.
- `diff-table.json`: `{ "codes": DIFF_CODES, "table": DIFF_TABLE }`.
- `diff/result.json`: the `DiffResult` of `diffContracts` when `before/` and `after/` each compile to one api, else `{ "<api>": DiffResult }` in api-name order (`diffContractSets`). `diff/report.txt`: `formatDiffReport`'s text, for several apis each report preceded by a line `== <api> ==` and a blank line between reports. An api of the sides with no IR makes the case a write error.
- `bundle/files.json`: `[{ "path", "size", "sha256" }]`, the manifest's `files`; `bundle/manifest.json`: the manifest's bytes; `bundle/integrity.txt`: the integrity and a newline; `bundle/ustar.json`: `[{ "path", "size", "mode", "uid", "gid", "mtime", "type", "uname", "gname", "sha256" }]`, one per tar entry in archive order, `size` and `sha256` left out for `seampact-bundle.json`.
- `<unit>/<NN>-<function>.json`: `{ "function", "args": [...], "result", "written"? }`. `NN` is the call's position among that unit's calls in the case, from `01`, in call order (a call nested in another counts from where it starts). Recorded: `cli-config` `readAppConfig`, `readRootConfig`, `readWorkspaceConfigs`, `readRunConfig`; `editor-schemas` `editorDeclarations`, `writeEditorSchemas`; `bundle-fetch` `fetchBundle`, `compileWorkspaceWithImports`; and, as `cli-config` calls, `selectArtefacts`, `planAppDocuments` and `planMergedDocuments`. `args` and `result` are what `JSON.stringify` writes with a `Map` as an object and a `Set` as an array, both in insertion order; the `reader` of `compileWorkspaceWithImports` becomes `{ "root": <the call's fetch.baseDirectory> }`. A bundle manifest in a result keeps the TypeScript's `compiler` member, which the comparison sets to `null` as for `bundle/manifest.json`. `written` holds the files the call created or changed (`{ "<path>": { "sha256", "text"? } }`, relative to the run root); the Rust subject replays each call on the case's tree as it was before the command. In a `steps` case the entry also holds `"step"`, the position of the `argv` step the call ran in, and the subject replays it on its own tree as it was before that step.
- `cli/transcript.json`: `{ "exit", "stdout", "stderr", "written": { "<path>": { "sha256", "text"? } }, "removed": [string] }`, paths relative to the run root, `text` present for UTF-8 files, `ustar` (the `bundle/ustar.json` entries of the gunzipped archive) present for a `.tgz`, whose `sha256` is not compared because its gzip bytes change once; `written` sorted by path.

Converted cases come from an instrumented run of the packages' unit tests (`node scripts/oracle/cli.ts record`): it records each `emitDocuments` and `diffContracts` call of the OpenAPI and diff tests and keeps one case per distinct input (the IR as the test built it, and the options). The recorder is a development tool: the cases are committed and `write` never needs it. The merge, lint, bundle and CLI cases are written by hand from fixtures, since their tests build IRs, plugins or temporary trees in memory.

## Generate and check cases

A CLI case whose `cli.json` holds `steps` instead of `argv` runs several commands on one root, in order (cases of `generate` and `check`, whose second command needs the files the first wrote).

- `cli.json`: `{ "steps": [<step>, ...], "env"? }`, `env` as above for every step. A step is one of: `{ "argv": [string], "cwd"? }` (a command, as the first form), `{ "write": { "<path>": "<text>" } }` (writes each file under the root, creating directories), `{ "remove": ["<path>"] }` (deletes each file or directory under the root; a path that is absent is a case error). Paths are relative to the root and `/` separated; a `write` or `remove` step has no transcript. A case holds `argv` or `steps`, never both; at least one `argv` step.
- `cli/<NN>-transcript.json` per `argv` step, in the shape of `cli/transcript.json`; `NN` is the step's position among the `argv` steps, from `01`. A `steps` case writes no `cli/transcript.json`. `written` and `removed` compare the root just before the step with the root just after it, so a `write` or `remove` step is never in a transcript.
- Each side runs its own `generate` before a `check` of the case: a check never reads files the other side wrote, whose formatting and manifests differ by design.
- The probe generators, three `defineTarget` twins of the Rust `seampact-gen-probe`: `fixtures/generators/probe-server`, `probe-provider` and `probe-client`, each a package directory (`package.json` with `"main": "index.cjs"`, `index.cjs`, written as CommonJS). The harness symlinks each to `<root>/node_modules/<id>` for every CLI case (the case's own `node_modules/<id>` wins), so `use: probe-server` resolves as an installed package; those links are left out of every transcript. The twin gets `defineTarget` and Prettier's `format` (3.9.10, the version of `packages/targets/codegen-ts`) from `globalThis.seampactOracleProbe = { defineTarget, format, irVersion, irRevision }`, set before the first case runs; the twin shares its body through `fixtures/generators/probe-common.cjs`. Their options, and the `request.json` they write with `echo: true`, are in `docs/maintainers/rust-design/generators.md`, section 2.
- A generated file is any file written under a directory that holds a written `.seampact-manifest.json`; the Rust harness compares such files as `generated` output (generators.md section 5, "Comparison on the Rust side").
- The `generated` entry rule of `differences.schema.json`: an entry with `applies.output: generated` needs `applies.path` (a literal path, no glob) and both `from` and `to`, the differing token text; the schema refuses the entry otherwise.

## Intended differences

`fixtures/expected/differences.yaml` (schema `differences.schema.json`, reader `differences.ts`) lists the differences between the TS oracle and the Rust port that are intended. Matching, for the Rust harness:

- One mismatch: both JSON values are walked together; a mismatch is one JSON pointer where they differ, a scalar that differs (`value`), a member or array element only in the Rust output (`added`) or only in the TS output (`removed`). Arrays compare by position (a length difference gives `added` or `removed` at each extra index), objects by member name, numbers by their text token (integers above 2^53 compare exactly). For `generated`, one mismatch is one file whose token streams differ (whitespace aside), or a file present on one side only.
- An entry matches a mismatch when all hold: the fixture path (relative to `fixtures/`) matches a glob of `applies.fixtures` (`*` within one path segment, `**` any number of segments, `dir/**` matches `dir` and what is under it, a glob without glob characters matches that path only); `applies.output` is the mismatch's output; the optional `applies.api` and `applies.half` equal the api and the half of the file; `applies.pointer` matches the pointer segment by segment, a segment exactly `*` matching any one segment (a `*` inside a segment, or `**`, is refused by the schema); for `generated`, `applies.path` is the file path, literal; `change` is the mismatch's kind (`message` needs the pointer's last segment to be `message` or `fix`, `code-renamed` needs `rule`, `code` or `id`, `member-order` is an object whose members are in another order, at that object's pointer, with no `from` or `to`); `from`, when present, equals the TS value and `to`, when present, the Rust value (JSON equality, numbers by token).
- A mismatch matched by no entry fails, and one matched by two or more entries fails as ambiguous. An entry that matches no mismatch in the whole run is stale and fails the gate.
- Accepting the mismatches of a file does not excuse the rest of its text: outside the accepted values and members the two files must be byte identical (layout, string escapes, number notation).
- A file present on one side only is a mismatch at the root pointer `""`, which no entry can name: a missing or extra whole file is never acceptable.

`format` applies to `generated` output only. The TS `check` ignores the file: TS is the `from` side.

## Rules without a fixture

`coverage` lists five rule ids that no contract fixture can trigger:

- `derive/error-params`: declared in the rule type, reported nowhere.
- `finalize/id-collision`: `tree/name-collision` refuses the same collisions earlier.
- `tree/relay-unknown`: needs an imported IR from a newer seampact with unknown closed values, which a contract cannot write.
- `load/expansion-limit`, `load/file-too-large`: size budgets too large for a committed fixture; unit tests cover them.

The diagnostics cap is silent: past it, diagnostics are dropped with no marker, so `diagnostics-cap-at` and `diagnostics-cap-over` expect the same output.
