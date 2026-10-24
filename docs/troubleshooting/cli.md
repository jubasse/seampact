# CLI errors

| You see | Do |
|---|---|
| `cli.usage: Unknown command 'frob'` | Run `seampact help` for the commands and their options. |
| `init.file-exists` | `init` writes a new project and found `seampact.config.yaml` or `contracts` already there; it wrote nothing. Run it in an empty folder, or run `seampact init --modelines` to add modelines to an existing project. |
| `init.modelines.no-source` | `init --modelines` edits the contract files of `path` sources only. Add `{ path: ./contracts }` to `sources`. |
| `lint.no-source` | `lint` reads the contract, so it needs a source with a `path`. Add `{ path: ./contract }` to `sources`. |
| `diff.against.invalid` | `--against` takes a folder of `<api>.ir.json` files (made by `seampact compile --out`) or one IR file. |
| `compile.editor-schemas.outside` | `--editor-schemas` writes only below the workspace root, through no symbolic link. Name a relative directory in `workspace.editorSchemas` (default `.seampact/schemas`), and replace a symlinked directory or schema file by a real one. |
| `diff.no-api` | The config names no api. Name one in `api` or `apis` of a target entry. |
| `diff.policy.breaking` | The change breaks clients and `compat.policy` is `additive-only`. Make the change additive, or set `compat: { policy: none }` for a release that breaks on purpose. See [Diff](../features/diff.md). |
| `diff.maturity.stable` | A stable operation takes additive changes only. Revert the change, or add a successor operation and deprecate this one. |
| `diff.api.name.differs`, `diff.api.version.differs` | The baseline is another api or another path version. Diff against a baseline of the same api and version. |

The commands exit with 1 when they report an error and 0 when they do not.
