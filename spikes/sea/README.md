# SEA spike (p1-sea-spike)

Status: stage one (Linux build and local linux x64 smoke). The verdict, the measures table and the
CI run URL are written in stage two, after the `p1-sea-spike` workflow has run on the five runners.

Verdict: pending.

## What it proves

ADR 0010: a stand-in compiler (`src/main.ts`, using only `fs`, `path`, `crypto` and `process`,
behind an injected reader) becomes a Node single executable application for linux x64 and arm64
(glibc), macOS x64 and arm64 and Windows x64, all from one Linux job. The program reads the YAML
files of a directory with `yaml`, refuses anchors and aliases with a located message
(`a.yaml:2:3: ...`, exit 1), and prints a canonical JSON value (sorted keys, LF, final newline) and
its SHA-256.

## Steps

All from `spikes/sea/`, on Linux, with Node 24.21.0 (the `.nvmrc` pin), `gpg`, `curl`, `tar`, `unzip`:

1. `pnpm install --frozen-lockfile`. The directory has its own `pnpm-workspace.yaml` (it only sets
   `allowBuilds`, esbuild's install script is not needed), so it is a separate project from the root
   workspace. Plain `pnpm install --ignore-workspace` fails under pnpm 12 because the flag ignores
   that file and esbuild's build script is then reported as unapproved.
2. `pnpm build` (`scripts/build.mjs`):
   - esbuild bundles `src/main.ts` into `dist/bundle.cjs` (CommonJS: the Node 24 SEA entry is a
     script; `require` in it only loads built-ins). The metafile and a grep of the bundle fail the
     build on any Node module beyond `fs`, `path`, `crypto` and `process`.
   - `node --experimental-sea-config` writes `dist/sea.blob` with `useCodeCache: false`,
     `useSnapshot: false`, `disableExperimentalSEAWarning: true`.
   - The five official Node 24.21.0 archives are downloaded from nodejs.org. The clearsigned
     `SHASUMS256.txt.asc` is verified with gpg against `node-release-keys.asc` (the 29 keys of
     nodejs/release-keys `keys.list`, committed as the trust root), then each archive's SHA-256 is
     checked against it. Any mismatch fails the build.
   - `postject` injects the blob (`NODE_SEA_BLOB`, sentinel fuse
     `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `--macho-segment-name NODE_SEA` for macOS).
   - Output: `dist/bin/seampact-spike-<platform>` and `SHA256SUMS`.
3. `node scripts/reference.mjs dist/reference` writes the `node dist/bundle.cjs` stdout and anchor
   stderr that every smoke compares against, byte for byte.
4. `node scripts/smoke.mjs <binary> dist/reference` on each platform's own runner.
5. macOS only, on the macOS runner: `codesign --remove-signature` then `codesign --force --sign -`
   (the injection on Linux leaves the original signature stale).

## Runners

`ubuntu-24.04` (build and linux x64), `ubuntu-24.04-arm`, `macos-15` (arm64), `macos-15-intel`
(x64), `windows-2025`.

## Caveats so far

- Pins: `esbuild` 0.28.2, `yaml` 2.9.1, `postject` 1.0.0-alpha.6. postject has no stable release;
  its `latest` tag is that alpha (last published 2023-05) and the Node docs use it.
- postject prints LIEF warnings on the ELF binaries and "The signature seems corrupted!" on the
  Mach-O ones; both are expected here and the output runs (linux x64) or is re-signed (macOS).
- The binary is about 121 MB (linux x64), the size of the Node binary itself.
- `yaml` imports `buffer` for its YAML 1.1 binary tag only; the core schema never reaches it. The
  API check tolerates it and nothing else.
- Local run (linux x64, this machine): build script 107 s with a warm download cache, smoke passes,
  also with `TZ=Asia/Kolkata` and `LANG=fr_FR.UTF-8`.
