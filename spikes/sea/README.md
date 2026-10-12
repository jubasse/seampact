# SEA spike (p1-sea-spike)

Status: complete. Run URL: https://github.com/jubasse/seampact/actions/runs/38235349165
(workflow `p1-sea-spike`, commit 50de05d, 2026-10-12, all 6 jobs green: build plus 5 smoke).
The measures, the run URL and the runner images below are those of that run, which predates the
review fixes (Windows signature strip, reproducible blob, curl fetch, runner check, first-launch
timing, compressed sizes): to refresh after the next CI run.

## Verdict

**Go for Node SEA.** p3-binary builds the compiler binary as a Node 24.21.0 single executable
application (esbuild bundle, `postject` injection into the official Node binary of each platform),
all five platforms from one Linux job. Bun `--compile` and Deno `compile` were not tried: no
criterion of the brief failed, so the fallback was not needed.

Deciding criterion: every platform ran the binary on its own OS runner with stdout byte-identical
to `node dist/bundle.cjs` on Linux, exit code 0, and the anchor fixture gave a non-zero exit with
the located message `a.yaml:2:3: anchors are not allowed`. The needed Node APIs (`fs`, `path`,
`crypto`, `process`) all work in the SEA. Size (90 to 121 MiB uncompressed) and warm start (36 to 175 ms)
are recorded, not gated (A11); the compressed download size is measured by the next run
(`dist/sizes.txt`, gzip level 9), and p3-binary re-measures it when it picks the release asset
format. The size is judged acceptable for a build-plugin download, with no threshold set. The five hosted
runners needed no paid signing: macOS binaries run after a free ad hoc re-sign, Windows with Node's
Authenticode signature removed before injection (ADR 0010: no Authenticode signing of our own).

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

## Measures (run 38235349165, not estimated)

Size is the file size in MiB (bytes / 1048576). The start column of these numbers is a warm start:
the median of 7 runs of the binary on the fixture, after two earlier runs of the same file (page
cache warm), measured by `scripts/smoke.mjs` on the platform's own runner (includes process spawn;
the macOS re-sign had been done). First-launch costs (macOS assessment of a freshly signed binary,
Defender scan on Windows) were not captured in this run; `smoke.mjs` now also reports the first
launch separately, and `dist/sizes.txt` the gzip size: both to refresh after the next CI run.

| Platform | Smoke runner | Size (MiB) | Start, warm median of 7 (ms) | Smoke |
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

Labels used (GitHub-hosted), with the image versions in the log of run 38235349165:
`ubuntu-24.04` (build and linux x64, image 20261004.327.1), `ubuntu-24.04-arm` (20261004.142.1),
`macos-15` (arm64, image macos-15-arm64 20260907.0337.1), `macos-15-intel` (x64, image macos-15
20260824.0482.1), `windows-2025` (image windows-2025-vs2026 20260925.250.1). A step now asserts
`node -p process.arch` equals the matrix architecture, so the darwin-x64 job proves x64 only on an
Intel runner.

## Caveats for p3-binary

- postject: the only line is `1.0.0-alpha.6` (npm `latest` is that prerelease, published 2023-05,
  no stable release). It is pinned exactly and the Node docs use it. It worked for all five targets,
  but p3-binary depends on an unmaintained alpha. Node 24.21.0 has no `--build-sea`; the current
  Node docs describe `node --build-sea` with an `executable` field (injects into another
  platform's binary without postject) and `mainFormat: "module"` for ESM: switch to it when the
  ADR 0001 pin moves to a Node line that has it. ELF output prints LIEF warnings (`Can't find
  string offset for section name '.note.100'`), harmless here, the binaries run. On Windows the
  warning `The signature seems corrupted!` came from the unstripped Node signature (run
  38235349165); with the strip it should be gone, to confirm in the next run.
- Reproducibility: with the relative `main` and esbuild `absWorkingDir`, two builds in two
  different directories gave identical SHA256SUMS locally (linux-x64 `49698f53…`, linux-arm64 `80a4d987…`, darwin-x64 `4ff04f84…`, darwin-arm64
  `5c6b96c6…`, win32-x64 `6f2aba29…`, built in two directories of different depth, blob
  byte-identical). Hashes also
  depend on the pinned Node archives, esbuild 0.28.2, yaml 2.9.1 and postject 1.0.0-alpha.6, which
  p3-binary must keep pinned; the local hashes differ from CI's (Linux and local may differ in
  anything else the build reads), so only builds on the same pinned inputs are comparable.
- pnpm 12: `pnpm install --ignore-workspace --frozen-lockfile` fails (exit 1, esbuild build script
  unapproved, because the flag ignores settings files). The spike has its own
  `pnpm-workspace.yaml` (`allowBuilds` esbuild: false) and uses plain `pnpm install
  --frozen-lockfile`; CI ran this fine under pnpm 12.11.2. p3-binary, inside the workspace, needs
  its own approval of esbuild's build script instead.
- For the lead: ADR 0010 says Apple silicon refuses to run an unsigned binary. The spike did not
  reproduce that on hosted runners (the unsigned arm64 binary exited 0, and the next run now also
  compares its stdout and prints its stderr). The ad hoc re-sign stays regardless.
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
- Quarantine: in run 38235349165 the binaries came from `download-artifact`, not curl or a browser,
  and carried no quarantine attribute (`xattr`: 0 matches on both runners). The workflow now serves
  `bin/` on localhost, fetches the binary with `curl` on both macOS jobs, then runs `xattr` and the
  binary (result to refresh after the next CI run). The behaviour of a quarantined browser download
  (Gatekeeper without notarisation) cannot be tested from CI.
- Linux ad hoc signing: signing the Mach-O from Linux with a pinned tool (for example rcodesign) was
  not tried, so the macOS re-sign still needs macOS runners. It could save the extra job.
- Windows: in run 38235349165 the binary still carried Node's Authenticode signature (PE security
  directory of 15688 bytes at the end of the file), invalid after injection, not unsigned as first
  written; it ran on windows-2025, but no SmartScreen, Defender, AppLocker or WDAC test is possible
  in CI. The signature is now stripped before injection (`scripts/pe.mjs`), verified empty in the
  build and on the Windows runner (next run). p3-binary must keep that step. Authenticode signing
  of our own stays out of 1.0 unless the lead decides otherwise.
- Anchor position: the message points at the anchored node (`a.yaml:2:3`), not at the anchor
  token (`&base` is at `a.yaml:1:7`), because `node.range` excludes the node's properties. p3-binary
  must locate the anchor token itself (from the CST `srcToken` props). The aliases check is never
  reached when the first error stops parsing.
- yaml debug output: `yaml` prints with `console.dir` / `console.log` to stdout when `LOG_STREAM` /
  `LOG_TOKENS` is set in the environment, which would mix debug lines into the compiler's stdout.
  p3-binary must delete both variables from `process.env` before parsing (or patch them out at
  bundle time) and run one smoke with `LOG_TOKENS=1 LOG_STREAM=1`.
- macOS x64 is the slowest platform to start (175 ms, Intel hosted runner, versus 36 to 88 ms
  elsewhere) and its job was the longest; it is a recorded measure, not a gate (A11).
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
