# CLI errors

| You see | Do |
|---|---|
| `cli.usage: Unknown command 'frob'` | Run `seampact help` for the commands and their options. |
| `init.file-exists` | `init` writes a new project and found `seampact.config.yaml` or `contract` already there; it wrote nothing. Run it in an empty folder, or run `seampact init --modelines` to add modelines to an existing project. |
| `init.modelines.no-source` | `init --modelines` edits the contract files of `path` sources only. Add `{ path: ./contract }` to `sources`. |
| `init.ignore-file-link` | `.gitignore` is a symbolic link, and `init` does not write through links. Run `seampact init --no-ignore-files`, then add `.seampact/` to the link's target yourself. |
| `init.local-sources-refused` | The starter contract is a local folder, and `SEAMPACT_ALLOW_LOCAL=false` or a root config's `allowLocal: false` refuses local sources. Run `init` where they are allowed, or write the app config yourself with a `package` source. |
| `binary.generate-unavailable`, `binary.check-unavailable` | The standalone binary has no code generator. Run `generate` and `check` with the npm CLI, or with the Gradle, Maven or Composer plugin. |
| `binary.artefact-unresolved` | The Gradle or Maven plugin did not find the compiler binary it pins. Add the repository that serves `io.github.jubasse:seampact-compiler`, or set `binary { path; sha256 }` to a binary on disk. |
| `binary.compile-refused` | The Gradle or Maven plugin compiled a `path` source and the compiler refused it. Fix the contract as the diagnostics under the message say. |
| `binary.compile-failed` | The compiler binary exited outside its contract (another exit code, a signal, or no IR). Run the build again; report it with the binary version if it repeats. |
| `binary.cache-unsafe` | Keep the binary cache private: `chmod 700` the directory the message names, or remove it. |
| `binary.ir-unreadable` | The compiler binary wrote an IR the plugin cannot read. Pin a binary of the plugin's version, and report it if they match. |
| `ir.version.unsupported`, `ir.revision.mismatch` | The Gradle or Maven plugin reads another IR version than the compiler or the bundle wrote. Use a plugin and a compiler binary of the same seampact release, or a bundle built by it. |
| `ir.kind.unsupported`, `ir.feature.unsupported`, `ir.must-act.unknown`, `ir.value.unknown` | The contract uses something this plugin release does not generate yet. Update the plugin, or compile with the seampact version that matches it. |
| `ir.support.malformed`, `ir.nesting.too-deep` | The IR is damaged or not written by seampact. Compile or bundle the contract again with the seampact binary. |
| `lint.no-source` | `lint` reads the contract, so it needs a source with a `path`. Add `{ path: ./contract }` to `sources`. |
| `diff.against.invalid` | `--against` takes a folder of `<api>.ir.json` files (made by `seampact compile --out`) or one IR file. |
| `compile.editor-schemas.outside` | `--editor-schemas` writes only below the workspace root, through no symbolic link. Name a relative directory in `workspace.editorSchemas` (default `.seampact/schemas`), and replace a symlinked directory or schema file by a real one. |
| `diff.no-api` | The config names no api. Name one in `api` or `apis` of a target entry. |
| `diff.policy.breaking` | The change breaks clients and `compat.policy` is `additive-only`. Make the change additive, or set `compat: { policy: none }` for a release that breaks on purpose. See [Diff](../features/diff.md). |
| `diff.maturity.stable` | A stable operation takes additive changes only. Revert the change, or add a successor operation and deprecate this one. |
| `diff.api.name.differs`, `diff.api.version.differs` | The baseline is another api or another path version. Diff against a baseline of the same api and version. |
| `explain.api.needed`, `explain.api.ambiguous`, `explain.api.unknown` | Name the operation as `<api>.<operationId>`, or `<source>/<api>.<operationId>` when two sources hold the api. |
| `explain.operation.unknown` | Name one of the api's operation ids, as the IR and the OpenAPI document spell them. |
| `bundle.source.none`, `bundle.source.ambiguous`, `bundle.source.unknown`, `bundle.source.not-local` | `bundle` packs a `path` source. With several, name one with `--source <name>`. Bundle in the repository that holds the contract. For the other `bundle.` codes, see [Bundle errors](bundle.md). |

The commands exit with 1 when they report an error, 2 on a usage error (an unknown command or option, or a command the binary does not carry), and 0 otherwise.
