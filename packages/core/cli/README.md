# @seampact/cli

The `seampact` command. It reads the app config, `seampact.config.yaml` (ADR 0011), compiles the contract sources its targets use, and runs each target package resolved from the app's own project.

- `seampact compile [--config <path>] [--out <dir>]` prints the compiler's diagnostics; `--out` writes each api's IR as `<api>.ir.json`.
- `seampact generate [--config <path>]` generates every target entry in memory, then writes each entry's files under `outDir` when no entry was refused. On a root config (a file holding `apps`) it runs each listed app, then writes the merged `openapi` documents.
- `seampact check [--config <path>]` runs `generate` in memory and compares each file and document with the committed ones, naming each file that differs: `checks.generated` for generated files, `checks.openapi` for documents (`error` by default, `warning` reports and passes, `disabled` skips), `checks.matrix` for untested framework versions. Every source is compiled, and a bundle source goes through the pinned-bundle check. It writes nothing.
- `seampact lint [--config <path>]` runs the core lint rules over each `path` source.
- `seampact diff --against <path> [--config <path>]` classifies the changes since the IRs at `<path>` (an IR file, or a directory of `<api>.ir.json` files as `compile --out` writes them), with the app config's `diff.gate` and `diff.exempt`.

Exit codes: 0 when everything was written or checked, 1 on a refusal, a compile error, a drift at `error`, a lint error or a failed diff gate, 2 on a usage error.

Until the packages are built, run the command from a checkout of this repository:

```sh
node --experimental-transform-types --import ./scripts/ir-models/register.ts packages/core/cli/src/bin.ts generate --config <app>/seampact.config.yaml
```
