### The standalone compiler binary

Content: the compiler and every CLI command that needs no target or plugin, `init`, `compile` (with `--editor-schemas`), `lint` with the core rules, `diff`, `explain` and `bundle`, with the first-party packs embedded (ADR 0008). A release build embeds each pack's files from its npm tarball, so the binary vendors the bytes npm publishes. A Java or PHP team that owns a contract repository therefore runs its release gate (`diff` under `compat.policy: additive-only`), its lint and its editor schemas without Node.js. It carries no codegen target and no npm package loader, so it runs `generate` and `check` only on an app config whose target entries are all native, each `use` a Maven coordinate or a Composer package: it writes or checks the config's seampact OpenAPI documents and its pinned bundles, prints that it leaves each entry to its build plugin, and reads each native entry as a server entry, since every native target is a server target. An npm entry is refused by name, `binary.generate-unavailable` or `binary.check-unavailable` naming the entry (exit 1), pointing to the npm CLI. Native consumers generate their entries with their own plugin, which asks the binary for the documents; and lint plugins, being npm packages, stay with the Node CLI (FR-12).

Build: esbuild bundles the compiler and CLI into one file (architecture external dependency), which is wrapped as a Node single executable application on the Node version pinned by ADR 0001. One Linux job builds all five binaries by injecting the same blob into the official Node binaries of each platform, verified against the Node project's signed checksums. Code cache and startup snapshot stay off, since cross-platform builds do not support them.

Platforms (A26): linux x64 and arm64 (glibc), macOS x64 and arm64, Windows x64.

Signing:
- macOS: the injected binary is re-signed ad hoc on a macOS runner; Apple silicon refuses to run an unsigned binary. Developer ID signing and notarisation are not needed for a binary that a build plugin downloads, since no quarantine attribute is set; the spike verifies this.
- Windows: unsigned in 1.0. Authenticode signing is added if a consumer's policy requires it.

Smoke tests: on each platform's own CI runner, the binary compiles the reference contract and its IR must be byte-identical to the IR produced by the Node CLI on Linux (A26). The CLI version and the binary version are the same.

A spike runs first: a hello-world compiler built for the five platforms from one Linux job and smoke-run on each OS.

Fallback, if SEA proves unfit (a platform fails, startup or size is unacceptable, or a needed Node API is missing): Bun's `--compile`, which cross-compiles every platform from one host; Deno's `compile` second. To keep the fallback open, the compiler reads files only through an injected reader, and the bundled CLI may require only these Node built-ins: `buffer`, `child_process`, `crypto`, `fs`, `fs/promises`, `https`, `module`, `os`, `path`, `process`, `url`, `util` and `zlib`. The build fails on any other, so a new built-in gets a decision (another runtime may lack it). The decision (one standalone binary per platform, pinned by hash) does not change with the runtime; the artifact names and the hash manifest stay the same.

Distribution and pinning:
- The binaries and a hash manifest (SHA-256 per platform) are release assets of the seampact repository.
- Each plugin release embeds a default binary version and its hashes. A consumer may override the version and hashes, the download URL (for a mirror) or a local path, always with a hash.
- The plugin verifies the hash before every first use and never runs a binary whose hash differs. Downloads are cached by hash in the ecosystem's cache directory.
- Before publication, test consumers point the plugin at a locally built binary and its hash (ADR 0011).
