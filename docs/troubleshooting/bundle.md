# Bundle errors

A bundle is a contract packed to share. See [Sharing a contract](../features/sharing-contracts.md).

## Reading a pinned bundle (`generate`, `check`)

| You see | Do |
|---|---|
| `bundle.integrity-mismatch`, `bundle.pin-missing`, `bundle.pin-mismatch` | The bundle is not the one you pinned. Pin the `integrity` the publisher printed, or ask the publisher whether the release changed. |
| `bundle.manifest-*`, `bundle.file-*`, `bundle.too-*`, `bundle.ir-*` | The bundle is damaged or was written by another seampact version. Download it again. If it still fails, rebuild it with `seampact bundle`. |

## Downloading it

| You see | Do |
|---|---|
| `bundle.archive-*` | The archive is malformed or too large. Download it again from the release. |

## Publishing it (`seampact bundle`)

| You see | Do |
|---|---|
| `bundle.compile-failed` | Fix the contract errors printed above it. |
| `bundle.contract-missing` | Name the contract with `--name` and `--version`, or add them to the contract folder's `package.json`. |
| `bundle.output-not-empty` | Pick an empty `--out`. |
| `bundle.imports-unsupported` | The contract's imports cannot travel in a bundle. Bundle the imported contract on its own. |
| `bundle.file-outside-root` | Move the file under the workspace root, or install it as a pack package. |
| `bundle.path-unportable` | Rename the file and its references to letters, digits and `. _ @ + -`. |
| `bundle.pack-unreadable` | Reinstall the pack package, so its `package.json` holds a version. |
| `bundle.label-invalid` | Give the contract and its packs names and versions of printable ASCII, at most 214 characters. |

For the `bundle.source.*` codes of the command, see [CLI errors](cli.md).
