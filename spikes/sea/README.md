# SEA spike (p1-sea-spike)

Status: complete. Run URL: https://github.com/jubasse/seampact/actions/runs/38237233164
(workflow `p1-sea-spike`, commit 73fed77, 2026-10-12, all 6 jobs green: build plus 5 smoke).
The measures, the run URL and the runner images below are those of that run, which includes the
review fixes (Windows signature strip, path-independent blob, curl fetch, runner architecture
check, first-launch timing, compressed sizes). The earlier run 38235349165 (commit 50de05d) is
superseded. Only the build-job step summary of this run (`dist/sizes.txt`) cannot be read through
the API: the gzip-9 sizes below were computed with the same method (`zlib` level 9) on the run's
`sea-binaries` artifact, and are identical to the `dist/sizes.txt` of a local build whose
`SHA256SUMS` equals the artifact's.

## Verdict

**Go for Node SEA.** p3-binary builds the compiler binary as a Node 24.21.0 single executable
application (esbuild bundle, `postject` injection into the official Node binary of each platform),
all five platforms from one Linux job. Bun `--compile` and Deno `compile` were not tried: no
criterion of the brief failed, so the fallback was not needed.

Deciding criterion: every platform ran the binary on its own OS runner with stdout byte-identical
to `node dist/bundle.cjs` on Linux, exit code 0, and the anchor fixture gave a non-zero exit with
the located message `a.yaml:2:3: anchors are not allowed`. The needed Node APIs (`fs`, `path`,
`crypto`, `process`) all work in the SEA. Size (89.6 to 121.1 MiB uncompressed, 34.2 to 42.3 MiB at gzip level 9), first launch (41 to 193 ms)
and warm start (38 to 101 ms) are recorded, not gated (A11); p3-binary re-measures the compressed
size when it picks the release asset format. The size is judged acceptable for a build-plugin
download, with no threshold set. The five hosted runners needed no paid signing: the Windows binary
ran with Node's Authenticode signature removed before injection (`pe.mjs check` passed on the
runner: security directory offset 0, size 0; ADR 0010: no Authenticode signing of our own), and the
macOS binaries ran even unsigned on the hosted runners, which do not enforce signing (see the
caveats), then again after a free ad hoc re-sign, which stays in the plan.

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
   - `node --experimental-sea-config` runs with `cwd: dist` and a relative `main`, so the blob
     does not embed the checkout path (it used to, which made hashes depend on the directory), and
     writes `dist/sea.blob` with `useCodeCache: false`,
     `useSnapshot: false`, `disableExperimentalSEAWarning: true`.
   - The five official Node 24.21.0 archives are downloaded from nodejs.org. The clearsigned
     `SHASUMS256.txt.asc` is verified with gpg against `node-release-keys.asc` (the 29 keys of
     nodejs/release-keys `keys.list`, committed as the trust root), then each archive's SHA-256 is
     checked against it. Any mismatch fails the build.
   - Windows only: Node's Authenticode signature is removed before the injection, on Linux, by
     `scripts/pe.mjs` (clears the PE security directory and the checksum, truncates the certificate
     table at the end of the file; no `osslsigncode`, which is not installed on the runner and would
     need an unpinned apt package). The build checks the directory is empty after injection and the
     Windows job re-checks it on the real binary (`pe.mjs check`). The Node docs do the same with
     `signtool remove /s`.
   - `postject` injects the blob (`NODE_SEA_BLOB`, sentinel fuse
     `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `--macho-segment-name NODE_SEA` for macOS).
   - Output: `dist/bin/seampact-spike-<platform>` and `SHA256SUMS`.
3. `node scripts/reference.mjs dist/reference` writes the `node dist/bundle.cjs` stdout and anchor
   stderr that every smoke compares against, byte for byte.
4. `node scripts/smoke.mjs <binary> dist/reference` on each platform's own runner.
5. macOS only, on the macOS runner: `codesign --remove-signature` then `codesign --force --sign -`
   (the injection on Linux leaves no valid signature).

## Measures (run 38237233164, not estimated)

Size is the file size in MiB (bytes / 1048576) as built on Linux, with the gzip level 9 size of
the same file (`dist/sizes.txt`). First launch is the first run of the binary on the fixture, and
warm start the median of 7 further runs after two warm-up runs (page cache warm), both measured
by `scripts/smoke.mjs` on the platform's own runner (includes process spawn). On macOS the smoke
runs after the ad hoc re-sign, so its file is 0.9 MiB larger than the Linux-built one (116.5 and
119.5 MiB in the smoke output); the first launch there includes the first assessment of a freshly
signed binary. Windows Defender scanning is not separated out.

| Platform | Smoke runner | Size (MiB) | gzip-9 (MiB) | First launch (ms) | Warm median of 7 (ms) | Smoke |
|---|---|---|---|---|---|---|
| linux x64 (glibc) | ubuntu-24.04 | 121.1 | 42.3 | 50 | 48 | pass |
| linux arm64 (glibc) | ubuntu-24.04-arm | 117.6 | 42.2 | 41 | 38 | pass |
| macOS arm64 | macos-15 | 115.6 | 37.6 | 102 | 61 | pass |
| macOS x64 | macos-15-intel | 118.6 | 38.6 | 193 | 101 | pass |
| Windows x64 | windows-2025 | 89.6 | 34.2 | 100 | 85 | pass |

Exact sizes in bytes (gzip-9 in bytes): linux x64 126946496 (44322500), linux arm64 123276416
(44298461), macOS x64 124322108 (40519811), macOS arm64 121205092 (39455372), Windows x64
93976576 (35887337).

Linux job (`ubuntu-24.04`):
- `pnpm build` script: 60.7 s for the five binaries (downloads of the five Node archives, gpg and
  SHA-256 verification, five injections, and now a gzip level 9 pass over each binary; esbuild and
  blob under 1 s). The previous run measured 33.3 s without the gzip pass.
- Whole build job: 88 s (10:35:03 to 10:36:31 UTC), including checkout, pnpm and Node setup,
  install, reference output and artefact upload.
- Smoke jobs: 12 to 15 s (Linux), 32 s (Windows), 88 s (macOS arm64) and 103 s (macOS x64); the
  macOS jobs include the curl step (about 37 s each), the re-sign and the extra artefact upload.
- The linux x64 binary also passed with `TZ=Asia/Kolkata LANG=fr_FR.UTF-8 LC_ALL=fr_FR.UTF-8`
  (start 49 ms, warm 47 ms), and Windows ran from a `core.autocrlf=true` checkout (CRLF
  fixtures) with output equal to the reference.

## Runners

Labels used (GitHub-hosted), with the image versions in the log of run 38237233164:
`ubuntu-24.04` (build and linux x64, image 20261004.327.1), `ubuntu-24.04-arm` (20261004.142.1),
`macos-15` (arm64, image macos-15-arm64 20260907.0337.1), `macos-15-intel` (x64, image macos-15
20260824.0482.1), `windows-2025` (image windows-2025-vs2026 20260925.250.1). The step asserting
`node -p process.arch` equals the matrix architecture passed on all 5 smoke jobs (linux-x64:
x86_64/x64, linux-arm64: aarch64/arm64, darwin-x64 on macos-15-intel: x86_64/x64, darwin-arm64 on
macos-15: arm64/arm64, win32-x64: x64), so the darwin-x64 result comes from an Intel runner. The step now also checks the machine
(`uname -m`, and Rosetta translation on macOS), not only Node's architecture; that stricter gate
was not part of run 38237233164.

## Caveats for p3-binary

- postject: the only line is `1.0.0-alpha.6` (npm `latest` is that prerelease, published 2023-05,
  no stable release). It is pinned exactly and the Node docs use it. It worked for all five targets,
  but p3-binary depends on an unmaintained alpha. Node 24.21.0 has no `--build-sea`; the current
  Node docs describe `node --build-sea` with an `executable` field (injects into another
  platform's binary without postject) and `mainFormat: "module"` for ESM: switch to it when the
  ADR 0001 pin moves to a Node line that has it. ELF output prints LIEF warnings (`Can't find
  string offset for section name '.note.100'`), harmless here, the binaries run. On Windows the
  warning `The signature seems corrupted!` came from the unstripped Node signature (run
  38235349165); with the strip it is gone in run 38237233164 (no such line in any log).
- Reproducibility: the CI `SHA256SUMS` (run 38237233164, Linux job, before any macOS re-sign) is
  linux-x64 `3575609b…`, linux-arm64 `07e581ff…`, darwin-x64 `ccf94f60…`, darwin-arm64 `76c304b2…`,
  win32-x64 `3874408e…`. A local build on Linux (Node 24.21.0, in `spikes/sea/dist` of the lane
  worktree, built just before the tip was committed) gave the identical five hashes, `sha256sum -c` against
  the CI manifest passing on all five files. So CI equals local for the same pinned inputs. The
  earlier hashes recorded here (`49698f53…`, `80a4d987…`, `4ff04f84…`, `5c6b96c6…`, `6f2aba29…`)
  do not match either: they are superseded, and the cause of that older difference was not
  isolated, so do not rely on them. The macOS binaries that p3-binary ships differ from this manifest after the ad hoc
  re-sign (the `signed-darwin-*` artefacts). Hashes depend on the pinned Node archives, esbuild
  0.28.2, yaml 2.9.1 and postject 1.0.0-alpha.6, which p3-binary must keep pinned. CI built in
  `/home/runner/work/seampact/seampact/spikes/sea` and the local build in another directory on
  another host: identical hashes, and the blob embeds no checkout path (0 matches).
- pnpm 12: `pnpm install --ignore-workspace --frozen-lockfile` fails (exit 1, esbuild build script
  unapproved, because the flag ignores settings files). The spike has its own
  `pnpm-workspace.yaml` (`allowBuilds` esbuild: false) and uses plain `pnpm install
  --frozen-lockfile`; CI ran this fine under pnpm 12.11.2. p3-binary, inside the workspace, needs
  its own approval of esbuild's build script instead.
- macOS signing, what the CI cannot show: ADR 0010 says Apple silicon refuses to run an unsigned
  binary, and that sentence stands. The unsigned binary nevertheless ran on the hosted macos-15
  arm64 runner (fetched with curl, `codesign -dv`: "code object is not signed at all", exit 0,
  stdout identical to the Node reference, stderr 0 bytes). The hosted runner did not enforce
  signing (the cause, for example SIP or AMFI settings in the image, was not checked), so the CI
  smoke cannot detect a missing or broken signature. p3-binary needs an explicit gate on the
  shipped macOS binaries: `codesign --verify --strict` and a non-empty `codesign -dv` signature.
  The same observation was made on the x64 runner (exit 0, stdout identical, stderr empty). It
  does not change the Go verdict, and the ad hoc re-sign stays in the plan.
- macOS ad hoc re-sign: `codesign --remove-signature` (tolerated failure) then
  `codesign --force --sign -`, then `codesign --verify --verbose=2` ("valid on disk", "satisfies its
  Designated Requirement") on a macOS runner, as a separate job step after the artefact download.
  The re-signed binary is not the one the Linux build hashed: p3-binary must hash and sign checksums
  after the re-sign, or sign on the macOS job and republish.
- Quarantine: in run 38237233164 both macOS jobs served `bin/` on localhost, fetched the binary
  with `curl`, `cmp` found it identical to the artefact, and `xattr` showed no quarantine attribute
  ("quarantine attribute present: 0" on both runners): this shows only that curl sets no
  quarantine attribute; it does not model a browser download. The behaviour of a quarantined browser download (Gatekeeper
  without notarisation) cannot be tested from CI. In run 38237233164 the step's
  `cat server.pid` failed and the local server was never killed (a background-list bug, harmless in
  a throwaway job, the fetch and checks were unaffected, and the step took about 37 s). The
  workflow now uses `--directory bin`, `$!`, a kill trap, and curl with retry and `--max-time`;
  that fix has not run in CI yet.
- Linux ad hoc signing: signing the Mach-O from Linux with a pinned tool (for example rcodesign) was
  not tried, so the macOS re-sign still needs macOS runners. It could save the extra job.
- Windows: in run 38235349165 the binary still carried Node's Authenticode signature (PE security
  directory of 15688 bytes at the end of the file), invalid after injection. In run 38237233164
  the build removed it (15688 bytes), checked the directory empty after injection, and the
  Windows runner re-checked the real binary: `pe.mjs check` printed `pe: security directory
  offset 0, size 0`. The unsigned binary passed the smoke on windows-2025 (first launch 100 ms,
  warm 85 ms), but no SmartScreen, Defender, AppLocker or WDAC test is possible in CI. p3-binary
  must keep the strip step. Authenticode signing of our own stays out of 1.0 unless the lead
  decides otherwise.
- Anchor position: the message points at the anchored node (`a.yaml:2:3`), not at the anchor
  token (`&base` is at `a.yaml:1:7`), because `node.range` excludes the node's properties. p3-binary
  must locate the anchor token itself (from the CST `srcToken` props). The aliases check is never
  reached when the first error stops parsing.
- yaml debug output: `yaml` prints with `console.dir` / `console.log` to stdout when `LOG_STREAM` /
  `LOG_TOKENS` is set in the environment, which would mix debug lines into the compiler's stdout.
  p3-binary must delete both variables from `process.env` before parsing (or patch them out at
  bundle time) and run one smoke with `LOG_TOKENS=1 LOG_STREAM=1`.
- macOS x64 is the slowest platform to start (first launch 193 ms, warm 101 ms, Intel hosted
  runner, versus 41 to 102 ms first launch and 38 to 85 ms warm elsewhere) and its job was the
  longest; it is a recorded measure, not a gate (A11). Run to run noise was not measured: the
  previous run gave 175 ms warm on the same runner label.
- Entry format: CommonJS. The Node 24.21.0 SEA entry is a script; `require` inside it only loads
  built-ins. An ESM entry was not tried.
- `yaml` imports `buffer` for its YAML 1.1 binary tag: `require("buffer")` runs when the bundle
  loads, only the call is never reached by the core schema. Both API checks (metafile and bundle
  grep) tolerate it for yaml only and nothing else; the lead is asked to accept this deviation from
  requirement 4 explicitly. Only module imports are checked: globals (`console`, `Buffer`,
  `process.env`, `process.binding`) pass, so p3-binary must not read the check as a global-API
  audit. Sentinel fuse and segment name
  (`NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `NODE_SEA`) match the Node 24 docs.
- Trust root: `node-release-keys.asc` holds the 29 keys of nodejs/release-keys `keys.list`; keep it in
  step with that list. CI verified `SHASUMS256.txt` against it and all archives against the file.
- Docs: Node SEA has no skill; the Node 24 documentation was read through Context7.
- Action pins used: checkout v7.0.1, pnpm/action-setup v6.1.0, setup-node v7.1.0, upload-artifact
  v7.0.2, download-artifact v8.0.2 (SHAs in the workflow). The artefact actions logged a Node
  `DEP0005` Buffer deprecation warning, harmless.
