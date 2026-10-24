# @seampact/binary

The standalone compiler binary (ADR 0010): the seampact CLI as a Node single executable application (SEA) on Node 24.21.0, for linux x64 and arm64 (glibc), macOS x64 and arm64 and Windows x64. It runs `init`, `compile`, `lint` (core rules), `diff`, `bundle` and `explain` with the first-party packs embedded, and needs no Node.js or `node_modules`.

`generate` and `check` need a codegen target, so they are refused by name (`binary.generate-unavailable`, `binary.check-unavailable`): use the npm CLI or the ecosystem plugin. The binary's `help` lists only its own commands.

## Build

From this directory, on Linux, with Node 24.21.0 (the `.nvmrc` pin), `gpg`, `curl`, `tar`, `unzip` and `xz`:

1. `pnpm build` bundles `src/main.ts` with esbuild (CommonJS), writes the SEA blob, downloads the five official Node 24.21.0 archives, verifies the signed `SHASUMS256.txt.asc` with gpg against `node-release-keys.asc` (the keys of nodejs/release-keys, keep it in step with that list) and each archive against it, strips the Authenticode signature of `node.exe`, and injects the blob with `postject`. Output: `dist/bin/seampact-<platform>` (unsigned).
2. `pnpm reference` compiles the smoke apps with the Node CLI and writes `dist/reference`.
3. `node scripts/smoke.mjs dist/bin/seampact-linux-x64 dist/reference` runs a binary on the same apps (copied outside the repository, so packs come from the binary) and compares the IR, the bundle tarball and the editor schemas of `compile --editor-schemas`, and every file `init` and `init --blank` write in an empty folder, byte for byte and the command answers with the reference.
4. On a macOS runner: `codesign --force --sign -` then `codesign --verify --strict` (hosted runners run an unsigned binary, so only this gate proves the signature).
5. `node scripts/manifest.mjs write <dir>` writes `SHA256SUMS` after signing.

The workflow `p3-binary` runs all of this, one smoke job per OS, and attests the binaries in a release-only job.

## Reference: the SEA spike

Measured by the spike (run 38237233164, 2026-10-12, a stand-in compiler of about 100 lines, not the CLI): every platform ran the binary on its own runner with output equal to Node's. Size is the file size as built on Linux; first launch is the first run, warm start the median of 7 later runs.

| Platform | Smoke runner | Size (MiB) | gzip-9 (MiB) | First launch (ms) | Warm median (ms) |
|---|---|---|---|---|---|
| linux x64 (glibc) | ubuntu-24.04 | 121.1 | 42.3 | 50 | 48 |
| linux arm64 (glibc) | ubuntu-24.04-arm | 117.6 | 42.2 | 41 | 38 |
| macOS arm64 | macos-15 | 115.6 | 37.6 | 102 | 61 |
| macOS x64 | macos-15-intel | 118.6 | 38.6 | 193 | 101 |
| Windows x64 | windows-2025 | 89.6 | 34.2 | 100 | 85 |

Caveats that still hold:

- `postject` has only an alpha line (`1.0.0-alpha.6`), pinned exactly. Node 24.21.0 has no `--build-sea`; switch to it when the Node pin moves to a line that has it.
- The ELF injection prints LIEF warnings (`Can't find string offset for section name '.note.100'`); the binaries run.
- Builds are reproducible for the same pinned inputs (Node archives, esbuild, postject): the blob embeds no checkout path.
- The Windows binary is unsigned (Node's signature is stripped); SmartScreen and Defender behaviour cannot be tested in CI. The docs give the manual-download workaround.
- No quarantine attribute is set on a binary fetched by a build plugin; a browser download cannot be tested from CI.
- `yaml` prints debug lines to stdout when `LOG_STREAM` or `LOG_TOKENS` is set; `main.ts` deletes both, and one smoke runs with them set.
