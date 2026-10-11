# ADR 0011: Distribution, app config and unpublished installs

Status: accepted

## Context

A contract repository publishes a versioned bundle: the YAML sources and the compiled IR, plus an integrity hash (brief section 13). The bundle ships through three channels in 1.0: npm package, release asset and git tag (amendment A26). A consumer app declares its sources and targets in its own config, pins a version, runs its generators and commits the outputs it reviews. A consumer check verifies that the pinned bundle is unaltered, and a local build can be refused on shared branches, as Arthome refuses a local `file:` build today.

Nothing is published before the project is complete (A3), so every package and bundle must be installable without a registry for the test consumers (A12, FR-36). Native consumers have no Node.js (A9, ADR 0010).

## Decisions

### The bundle

A bundle is a directory, or a deterministic tarball of it:

```text
seampact-bundle.json        manifest
sources/                    the YAML sources as authored
sources/.packs/<name>@<v>/  every pack the sources apply, vendored (ADR 0008)
ir/<api>.json               the canonical IR of each api, without the location side table
```

The manifest holds the bundle format version, the contract package name and version, each api with its `irVersion` and `irRevision`, the compiler version, the packs applied with their versions, the list of files (path, size, SHA-256), and the integrity value. Its JSON Schema is published in `@seampact/spec`, so the Kotlin and PHP readers (ADR 0010) verify bundles with no Node.js.

Integrity is `sha256-<base64>` over the canonical file list: one line per file, `<sha256 hex>  <path>`, sorted by path in code-unit order, the manifest itself excluded. The tarball is reproducible: entries sorted, modification times, owners and modes fixed, gzip with no timestamp or file name. The same sources and compiler therefore give the same integrity and the same tarball bytes on every machine.

`seampact bundle` compiles the workspace and writes the bundle. A bundle always carries its sources, so a consumer can review them and the IR can be rebuilt; it never carries OpenAPI documents or generated code, which each consumer generates.

### Channels

All three channels carry the same bundle and the same integrity value.

| Channel | Source kind | How a runner fetches it |
|---|---|---|
| npm package | `package` and `version` | Node: from the installed package. Native: the package tarball over the registry's HTTPS API, no npm client needed |
| release asset | `release` with the asset URL | HTTPS download of the tarball |
| git tag | `git` with the repository URL, tag and directory | a shallow fetch of the tag with the system `git` |

A runner caches fetched bundles by integrity value.

### The app config

Each app (a frontend, a backend, a service) has its own `seampact.config.yaml` (A37), read by the Node CLI and by every native runner, so a polyglot repository has one kind of file for all of them. An app config works alone. A monorepo may add a root `seampact.config.yaml` that lists its apps and declares the contract sources they share. Both schemas are published in `@seampact/spec`, and both are read with the loader's YAML rules (FR-1). The key names below are the design of this ADR; the published schemas are the reference.

```yaml
# seampact.config.yaml, at the root of a monorepo
apps: [apps/api, apps/web, services/billing]
allowLocal: true
sources:
  storefront: { package: '@acme/contracts', version: 2.3.0, integrity: sha256-Qm9vY... }
  billing:
    release: { url: https://github.com/acme/contracts/releases/download/billing-v1.4.0/billing.seampact.tgz }
    integrity: sha256-YmlsbG...
```

```yaml
# apps/api/seampact.config.yaml
sources:
  tasks: { path: ../../contracts/tasks }             # a local source, beside the root's
targets:
  - { id: validators, use: '@seampact/codegen-zod', api: storefront, out: src/generated/validators }
  - id: server
    use: '@seampact/codegen-nestjs'
    api: storefront
    out: src/generated/server
    link: { validators: validators }                 # provider seam, ADR 0009
    artefacts: { accessHooks: false }                # this app answers no access hook yet
    frameworkRoutes:
      - { method: GET, path: /metrics, reason: "Scraped by Prometheus; not part of the api." }
openapi:
  storefront: { public: openapi/storefront-public.yaml, full: openapi/storefront.yaml }
checks: { openapi: true, generated: true }           # drift checks (FR-11, ADR 0015)
```

```yaml
# services/billing/seampact.config.yaml: OpenAPI only, no code generated
openapi:
  billing: openapi/billing.yaml
checks: { openapi: true }
```

```yaml
# a Spring Boot app's seampact.config.yaml
targets:
  - use: 'io.github.jubasse:seampact-spring-boot'    # handled by the Gradle or Maven plugin
    api: tasks
    out: src/main/generated
    options: { package: com.acme.tasks.api }
```

Rules:
- The root config takes `apps` (the app directories), `sources` and `allowLocal`. An app config takes `sources`, `targets`, `openapi`, `checks` and `allowLocal`. An app inside a root's `apps` sees the root's sources beside its own; a name defined in both is an error naming both files. An app config outside any root, or run on its own, uses only its own sources.
- `api` names a source when that source holds one api, and `<source>/<api>` otherwise.
- `use` is an npm package name, a Maven `group:artifact` coordinate or a Composer `vendor/name`. Each runner handles the entries of its ecosystem and leaves the others; the forms cannot be confused.
- `artefacts` switches each artefact a target declares on or off (types, validators, route table, handler interfaces, access hooks, client, query hooks; ADR 0009). Everything a target declares is on by default.
- `openapi` maps an api to the path of its one document, or to a mapping from each of its documents (ADR 0002 section 5) to a path. An app config with `openapi` and no `targets` generates the documents and no code: an OpenAPI-only setup is a first-class one (A37). `checks.openapi: true` checks every document listed there for drift; `checks.generated: true` checks the committed generated files (ADR 0015).
- `frameworkRoutes` is the allow-list of framework routes outside the contract that the boot check accepts, each with a reason (FR-25, ADR 0012).
- The config is validated against the compatibility matrix before anything is generated (ADR 0009).
- Native plugins read the same file. The Gradle and Maven build files only point to it and to the binary pin (ADR 0010).

A contract workspace that relays to an api it does not compile names it in `workspace.imports` (ADR 0002 section 1). Such an entry takes the source forms of `sources` above, plus `api` (the api's name inside the bundle) and `integrity`, which is required there; it goes through the same pinned-bundle check.

### The pinned-bundle check

Before generating, and in `seampact check`, a runner verifies a bundle source:
1. every file's hash matches the manifest;
2. the manifest's integrity matches the `integrity` pinned in the config;
3. each IR file validates against the IR JSON Schema of its declared version.

A missing pin fails and prints the actual integrity, so pinning is a copy. A mismatch fails and names the files that differ. Native plugins run the same three steps in Kotlin or PHP.

Relays (FR-8) may point at an api in a pinned bundle, named in `workspace.imports` (ADR 0002 section 1): workspace compilation reads that bundle's IR, after the same check, for the superset check.

### Refusing local sources on shared branches

`allowLocal` (in the root or the app config, the app's winning) defaults to `true`. When it is `false`:
- a `path` source fails `compile`, `generate` and `check` with a diagnostic naming the source and the fix (use a pinned bundle);
- a `package` source that the package manager resolved from a local path (`file:`, `link:` or a workspace link) fails `check`.

The environment variable `SEAMPACT_ALLOW_LOCAL=false` forces the refusal regardless of the file, and can never turn it off. CI sets it on shared branches; a developer keeps local sources on a feature branch.

### Unpublished installs for test consumers

Test consumer projects live in `~/Dev/test-seampact-<name>` or a temporary directory, never in the monorepo (A12), and install exactly as a user would (FR-36):

| Ecosystem | How the unpublished packages are installed |
|---|---|
| npm | `pnpm pack` writes a tarball per package; the consumer's `package.json` lists the tarballs, and a `pnpm.overrides` entry maps every `@seampact/*` package to its tarball so transitive dependencies resolve to tarballs too |
| JVM | `publishToMavenLocal` from the monorepo; the consumer lists `mavenLocal()` in its plugin and dependency repositories |
| PHP | Composer path repositories pointing at the split trees of ADR 0010, with symlinks off so the install is a copy |
| Binary | a locally built binary, referenced by path and hash in the plugin's override |

No seampact package or bundle comes from a public registry; third-party dependencies come from their usual registries. Each test consumer records the monorepo commit it was built from in a `.seampact-commit` file written by its install script. The modularity checks of ADR 0009 run against these packed installs, never against workspace links.

### Channel smoke tests

Each channel has a CI smoke test (A26): a bundle of the reference contract is built, served through the channel (a local registry, a local HTTPS server, a local bare repository with a tag), fetched, verified and generated by the Node CLI, the Gradle plugin and the PHP runner. A tampered copy must fail the check. The binary platforms are smoke-tested as ADR 0010 says.

## Consequences

- A consumer in any ecosystem pins a contract the same way and gets the same verification.
- Pinning a bundle requires copying its integrity once per version bump.
- The git channel needs the `git` command on the machine that generates; every CI image has it.
- The npm channel's native fetch assumes a registry that serves package tarballs over HTTPS; a private registry is configured by URL and a token from the environment.

## Traceability

- FRs: FR-17, FR-36, FR-8 (relays to a pinned bundle), FR-11 (committed document checks), FR-25 (framework route allow-list); amendments A3, A9, A12, A26, A37.
- Checklist items enabled: CHK-052 (relays across a pinned bundle), CHK-059 (committed and drift-checked documents), CHK-063 (framework routes allow-listed with a reason), CHK-070 (test consumers), CHK-072 (unpublished installs), CHK-076 (native consumers read bundles), CHK-088 (PHP trees installable through path repositories), CHK-113 and CHK-114 (per-app configs, artefact switches, OpenAPI-only setups).
