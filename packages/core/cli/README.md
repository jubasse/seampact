# @seampact/cli

The `seampact` command. It reads the app config, `seampact.config.yaml` (ADR 0011), compiles the contract sources its targets use, and runs each target package resolved from the app's own project.

- `seampact compile [--config <path>] [--out <dir>]` prints the compiler's diagnostics; `--out` writes each api's IR as `<api>.ir.json`.
- `seampact generate [--config <path>]` generates every target entry in memory, then writes each entry's files under `outDir` when no entry was refused. On a root config (a file holding `apps`) it runs each listed app, then writes the merged `openapi` documents.
- `seampact check [--config <path>]` runs `generate` in memory and compares each file and document with the committed ones, naming each file that differs: `checks.generated` for generated files, `checks.openapi` for documents (`error` by default, `warning` reports and passes, `disabled` skips), `checks.matrix` for untested framework versions. Every source is compiled, and a bundle source goes through the pinned-bundle check. It writes nothing.
- `seampact lint [--config <path>]` runs the core lint rules over each `path` source.
- `seampact diff --against <path> [--config <path>]` classifies the changes since the IRs at `<path>` (an IR file, or a directory of `<api>.ir.json` files as `compile --out` writes them), with the app config's `diff.gate` and `diff.exempt`.
- `seampact explain <api>.<operationId> [--config <path>]` prints one operation as YAML, each line commented with the derivation that produced it and the file and line that caused it; the api may be left out when the sources hold one. Members it does not show yet are listed in a last comment.
- `seampact bundle (--out <dir> | --tarball <file> | --npm-package <dir>) [--source <name>] [--name <name>] [--version <version>] [--config <path>]` compiles a `path` source (the app config's only one, or `--source`) and writes its bundle (ADR 0011): a directory, a reproducible tarball for a release asset, or a directory with npm's `package.json` ready to publish. It prints the integrity value to pin. The contract's name and version come from the `package.json` at the workspace root unless `--name` and `--version` are given.
- `seampact init [--blank] [--editor-schemas[=ignore|commit|none]] [--no-modelines] [--no-ignore-files]` writes a new project in the working directory: `seampact.config.yaml` and `contracts/api.yaml`, a small commented example that compiles (`--blank`: the api header alone), its modeline, and the editor schemas (`ignore`, the default, also adds `.seampact/` to `.gitignore`; `commit` leaves them to be committed; `none` writes none and points the modeline at the installed `@seampact/spec`). It refuses, writing nothing, when the config or the `contracts` folder exists.
- `seampact init --modelines [--config <path>] [--editor-schemas[=...]] [--no-ignore-files]` writes or corrects the modeline of every contract file of the app config's `path` sources, each fragment taking the kind its include site expects, then writes their editor schemas; it names each file it leaves without one.

Exit codes: 0 when everything was written or checked, 1 on a refusal, a compile error, a drift at `error`, a lint error or a failed diff gate, 2 on a usage error.

Until the packages are built, run the command from a checkout of this repository:

```sh
node --experimental-transform-types --import ./scripts/ir-models/register.ts packages/core/cli/src/bin.ts generate --config <app>/seampact.config.yaml
```
