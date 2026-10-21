# CLI errors

| You see | Do |
|---|---|
| `cli.usage: Unknown command 'frob'` | Run `seampact help` for the commands and their options. |
| `cli.not-available: The command 'init' is not available yet` | `init` is planned. Use `compile`, `generate`, `check`, `lint`, `diff`, `bundle` or `explain`. |
| `lint.no-source` | `lint` reads the contract, so it needs a source with a `path`. Add `{ path: ./contract }` to `sources`. |
| `diff.against.invalid` | `--against` takes a folder of `<api>.ir.json` files (made by `seampact compile --out`) or one IR file. |
| `diff.no-api` | The config names no api. Name one in `api` or `apis` of a target entry. |
| `diff.policy.breaking` | The change breaks clients and `compat.policy` is `additive-only`. Make the change additive, or set `compat: { policy: none }` for a release that breaks on purpose. See [Diff](../features/diff.md). |
| `diff.maturity.stable` | A stable operation takes additive changes only. Revert the change, or add a successor operation and deprecate this one. |
| `diff.api.name.differs`, `diff.api.version.differs` | The baseline is another api or another path version. Diff against a baseline of the same api and version. |

The commands exit with 1 when they report an error and 0 when they do not.
