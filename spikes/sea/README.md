# SEA spike (p1-sea-spike)

Status: complete. Run URL: https://github.com/jubasse/seampact/actions/runs/38235349165
(workflow `p1-sea-spike`, commit 50de05d, 2026-10-12, all 6 jobs green: build plus 5 smoke).

## Verdict

**Go for Node SEA.** p3-binary builds the compiler binary as a Node 24.21.0 single executable
application (esbuild bundle, `postject` injection into the official Node binary of each platform),
all five platforms from one Linux job. Bun `--compile` and Deno `compile` were not tried: no
criterion of the brief failed, so the fallback was not needed.

Deciding criterion: every platform ran the binary on its own OS runner with stdout byte-identical
to `node dist/bundle.cjs` on Linux, exit code 0, and the anchor fixture gave a non-zero exit with
the located message `a.yaml:2:3: anchors are not allowed`. The needed Node APIs (`fs`, `path`,
`crypto`, `process`) all work in the SEA. Size (90 to 121 MB) and cold start (36 to 175 ms) are
recorded, not gated (A11), and are acceptable for a build-plugin download. The five hosted
runners needed no paid signing: macOS binaries run after a free ad hoc re-sign, Windows unsigned
(ADR 0010).

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
   (the injection on Linux leaves no valid signature).

## Measures (run 38235349165, not estimated)

Size is the file size in MiB (bytes / 1048576). Cold start is the median of 7 runs of the binary
on the fixture, measured by `scripts/smoke.mjs` on the platform's own runner (includes process
spawn; the macOS re-sign had been done).

| Platform | Smoke runner | Size (MiB) | Cold start (ms) | Smoke |
|---|---|---|---|---|
| linux x64 (glibc) | ubuntu-24.04 | 121.1 | 49 | pass |
| linux arm64 (glibc) | ubuntu-24.04-arm | 117.6 | 36 | pass |
| macOS arm64 | macos-15 | 116.5 | 45 | pass |
| macOS x64 | macos-15-intel | 119.5 | 175 | pass |
| Windows x64 | windows-2025 | 89.6 | 88 | pass |

Linux job (`ubuntu-24.04`):
- `pnpm build` script: 33.3 s for the five binaries (downloads of the five Node archives, gpg and
  SHA-256 verification, five injections; esbuild and blob under 1 s).
- Whole build job: about 61 s (10:17:09 to 10:18:10 UTC), including checkout, pnpm and Node setup,
  install, reference output and artefact upload.
- Smoke jobs: 10 to 82 s each, dominated by checkout and artefact download.
- The linux x64 binary also passed with `TZ=Asia/Kolkata LANG=fr_FR.UTF-8 LC_ALL=fr_FR.UTF-8`
  (49 ms), and Windows ran from a `core.autocrlf=true` checkout (CRLF fixtures) with output equal to
  the reference.

## Runners

Labels used (GitHub-hosted): `ubuntu-24.04` (build and linux x64, image 20261004.327.1),
`ubuntu-24.04-arm`, `macos-15` (arm64, image macos-15-arm64 20260907.0337.1), `macos-15-intel`
(x64), `windows-2025`.

## Caveats for p3-binary

- postject: the only line is `1.0.0-alpha.6` (npm `latest` is that prerelease, published 2023-05,
  no stable release). It is pinned exactly and the Node docs use it. It worked for all five targets,
  but p3-binary depends on an unmaintained alpha; watch for a Node-native replacement. ELF output
  prints LIEF warnings (`Can't find string offset for section name '.note.100'`) and the Windows PE
  one prints `The signature seems corrupted!`; both are harmless here, the binaries run.
- pnpm 12: `pnpm install --ignore-workspace --frozen-lockfile` fails (exit 1, esbuild build script
  unapproved, because the flag ignores settings files). The spike has its own
  `pnpm-workspace.yaml` (`allowBuilds` esbuild: false) and uses plain `pnpm install
  --frozen-lockfile`; CI ran this fine under pnpm 12.11.2. p3-binary, inside the workspace, needs
  its own approval of esbuild's build script instead.
- macOS, unsigned: the Mach-O binaries come out of the Linux injection with no usable signature
  (`codesign -dv` on both macOS runners: "code object is not signed at all"). Run before any
  re-sign, on both the arm64 and the x64 runner, they still exited 0 (information step). That is one
  observation on CI runners, with no quarantine attribute; do not read it as proof that an unsigned
  arm64 binary runs on users' Macs. The ad hoc re-sign stays in the plan.
- macOS ad hoc re-sign: `codesign --remove-signature` (tolerated failure) then
  `codesign --force --sign -`, then `codesign --verify --verbose=2` ("valid on disk", "satisfies its
  Designated Requirement") on a macOS runner, as a separate job step after the artefact download.
  The re-signed binary is not the one the Linux build hashed: p3-binary must hash and sign checksums
  after the re-sign, or sign on the macOS job and republish.
- Quarantine: the binaries here came from `download-artifact`, not a browser, and carried no
  quarantine attribute (`xattr`: 0 matches on both runners). The behaviour of a quarantined download
  (Gatekeeper without notarisation) was not tested and cannot be from CI; ADR 0010's plugin download
  path (a process fetching the file) normally sets no quarantine, but this is unverified.
- Linux ad hoc signing: signing the Mach-O from Linux with a pinned tool (for example rcodesign) was
  not tried, so the macOS re-sign still needs macOS runners. It could save the extra job.
- Windows: unsigned, ran fine on windows-2025 (no SmartScreen test is possible in CI). Authenticode
  stays out of 1.0 unless the lead decides otherwise.
- macOS x64 is the slowest platform to start (175 ms, Intel hosted runner, versus 36 to 88 ms
  elsewhere) and its job was the longest; it is a recorded measure, not a gate (A11).
- Entry format: CommonJS. The Node 24.21.0 SEA entry is a script; `require` inside it only loads
  built-ins. An ESM entry was not tried.
- `yaml` imports `buffer` for its YAML 1.1 binary tag only; the core schema never reaches it. The
  API check tolerates it and nothing else. Sentinel fuse and segment name
  (`NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `NODE_SEA`) match the Node 24 docs.
- Trust root: `node-release-keys.asc` holds the 29 keys of nodejs/release-keys `keys.list`; keep it in
  step with that list. CI verified `SHASUMS256.txt` against it and all archives against the file.
- Docs: Node SEA has no skill; the Node 24 documentation was read through Context7.
- Action pins used: checkout v7.0.1, pnpm/action-setup v6.1.0, setup-node v7.1.0, upload-artifact
  v7.0.2, download-artifact v8.0.2 (SHAs in the workflow). The artefact actions logged a Node
  `DEP0005` Buffer deprecation warning, harmless.
