<!-- Generated from docs/troubleshooting/bundle.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Bundle errors

Page: https://jubasse.github.io/seampact/troubleshooting/bundle/

A bundle is a contract packed to share. See [Sharing a contract](https://jubasse.github.io/seampact/features/sharing-contracts/).

## Reading a pinned bundle (`generate`, `check`)

| Code | Cause and fix |
|---|---|
| `bundle.integrity-mismatch`, `bundle.pin-missing`, `bundle.pin-mismatch` | The bundle is not the one you pinned. Pin the `integrity` the publisher printed, or ask the publisher whether the release changed. |
| `bundle.manifest-*`, `bundle.file-*`, `bundle.too-*`, `bundle.ir-*` | The bundle is damaged or was written by another seampact version. Download it again. If it still fails, rebuild it with `seampact bundle`. |
| `bundle.cache-invalid` | The cached copy changed after it was saved. Remove the folder the message names, then run again. |
| `bundle.package-unsupported` | PHP and Python: `package` sources are not read yet. Use the same bundle as a `release` or `git` source. |
| `bundle.maven-jvm-only` | The npm CLI and the Python build do not read `maven` sources. Run `generate` and `check` with the Gradle or Maven plugin, or use a `package`, `release` or `git` source. |

## Downloading it

| Code | Cause and fix |
|---|---|
| `bundle.release-url`, `bundle.release-failed` | The `release` URL is not `https`, or does not answer with the archive. Use an `https` URL that returns the archive. |
| `bundle.git-url`, `bundle.git-tag`, `bundle.git-directory`, `bundle.git-failed` | Check the `git` URL, the tag and the folder. The tag must exist. |
| `bundle.source-local` | The source is a local path. Use a remote `git` URL or a `release`. |
| `bundle.archive-*` | The archive is malformed or too large. Download it again from the release. |

## Publishing it (`seampact bundle`)

| Code | Cause and fix |
|---|---|
| `bundle.compile-failed` | The contract has errors, so it cannot be packed. Fix the errors printed above it. |
| `bundle.contract-missing` | The bundle has no name or version. Name the contract with `--name` and `--version`, or add them to the contract folder's `package.json`. |
| `bundle.output-not-empty` | The `--out` folder already holds files. Pick an empty one. |
| `bundle.imports-unsupported` | The contract's imports cannot travel in a bundle. Bundle the imported contract on its own. |
| `bundle.file-outside-root` | A file sits outside the workspace root. Move it under the root, or install it as a pack package. |
| `bundle.path-unportable` | A file name has characters that do not travel. Rename the file and its references to letters, digits and `. _ @ + -`. |
| `bundle.pack-unreadable` | The pack package has no readable version. Reinstall it, so its `package.json` holds a version. |
| `bundle.label-invalid` | A name or version is not printable ASCII, or is too long. Give the contract and its packs names and versions of printable ASCII, at most 214 characters. |

For the `bundle.source.*` codes of the command, see [CLI errors](https://jubasse.github.io/seampact/troubleshooting/cli/).
