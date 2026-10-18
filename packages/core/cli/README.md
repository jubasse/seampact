# @seampact/cli

The `seampact` command. It reads the app config, `seampact.config.yaml` (ADR 0011), compiles the contract sources its targets use, and runs each target package resolved from the app's own project.

- `seampact compile [--config <path>] [--out <dir>]` prints the compiler's diagnostics; `--out` writes each api's IR as `<api>.ir.json`.
- `seampact generate [--config <path>]` generates every target entry in memory, then writes each entry's files under `outDir` when no entry was refused.

Exit codes: 0 when everything was written, 1 on a refusal or a compile error, 2 on a usage error.

Until the packages are built, run the command from a checkout of this repository:

```sh
node --experimental-transform-types --import ./scripts/ir-models/register.ts packages/core/cli/src/bin.ts generate --config <app>/seampact.config.yaml
```
