# ADR 0011: Distribution, app config and unpublished installs

Status: accepted

## Context

A contract repository publishes a versioned bundle: the YAML sources and the compiled IR, plus an integrity hash. The bundle ships through three channels in 1.0: npm package, release asset and git tag (amendment [A26](../decisions.md#a26)). A consumer app declares its sources and targets in its own config, pins a version, runs its generators and commits the outputs it reviews. A consumer check verifies that the pinned bundle is unaltered, and a local build (a `file:` dependency, for example) can be refused on shared branches.

Nothing is published before the project is complete ([A3](../decisions.md#a3)), so every package and bundle must be installable without a registry for the test consumers ([A12](../decisions.md#a12), FR-36). Native consumers have no Node.js ([A9](../decisions.md#a9), ADR 0010).

## Options

- Bundle content: the compiled IR alone, the YAML sources alone, or both under one integrity value. Choice: both. The IR alone cannot be reviewed or rebuilt, and the sources alone make every consumer run the compiler and resolve the packs.
- Config: one config at the repository root for every app, or one config per app with an optional root that shares sources. Choice: per app ([A37](../decisions.md#a37)), so a frontend, a backend and a native service each read only their own keys.

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

`seampact bundle` compiles the workspace and writes the bundle. A bundle always carries its sources, so a consumer can review them and the IR can be rebuilt; it never carries OpenAPI documents or generated code, which each consumer generates. The sources are carried as the loader read them: UTF-8 with no byte order mark, an invalid UTF-8 sequence replaced by U+FFFD, so they are the text the IR was compiled from, not always the authored bytes. Each CRLF line end of a carried file becomes LF, so the same contract at the same commit gives the same bundle bytes on every OS, whatever line ends its checkout has. Rebuilding the IR from a bundle's sources is out of 1.0 until a consumer needs it: no loader reads `sources/.packs/`, so the vendored packs are there for review and the sources still name their packs by package.

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
openapi:
  platform:                                          # one document across the apps (A43)
    path: openapi/platform.yaml
    apps: [apps/api, services/billing]               # the apps it covers; default every app of `apps`
    prefix: { billing: billing }                     # billing.listInvoices, billing.Invoice
    extensions: none
checks: { openapi: error }                           # the default: drift in a merged document fails check
```

```yaml
# apps/api/seampact.config.yaml
outDir: src/__generated__                            # every generated file of this app (A41)
sources:
  tasks: { path: ../../contracts/tasks }             # a local source, beside the root's
targets:
  - { id: validators, use: '@seampact/codegen-zod', api: storefront }   # writes src/__generated__/validators
  - id: server
    use: '@seampact/codegen-nestjs'
    api: storefront
    mount: /api                                      # the global prefix main.ts sets
    link: { validators: validators }                 # provider seam, ADR 0009
    artefacts: { nativeDocs: true }                  # also complete the @nestjs/swagger document
    frameworkRoutes:
      - { method: GET, path: /metrics, reason: "Scraped by Prometheus; not part of the api." }
      - { method: GET, path: '/admin/queues/**', reason: "The queue dashboard's own routes." }
openapi:
  storefront:
    public: { path: openapi/storefront-public.yaml, extensions: [access, paging], reasons: omit }
    full: openapi/storefront.yaml
checks: { openapi: error, generated: error }         # drift checks, the defaults (FR-11, ADR 0015)
```

```yaml
# apps/web/seampact.config.yaml: React with a typed fetch client and TanStack Query hooks
targets:
  - { id: client, use: '@seampact/codegen-fetch', api: storefront, document: public }
  - id: hooks
    use: '@seampact/codegen-react'
    api: storefront
    document: public                                 # internal routes stay out of the browser
    link: { client: client }                         # the client link kind, ADR 0009
```

```yaml
# a standalone NestJS app serving a public and a service api of one workspace
sources:
  contracts: { path: ../contracts }                  # its workspace.yaml lists tasks and tasksService
targets:
  - { id: validators, use: '@seampact/codegen-zod', apis: [tasks, tasksService] }
  - id: server
    use: '@seampact/codegen-nestjs'
    apis: [tasks, tasksService]
    link: { validators: validators }
```

```yaml
# services/billing/seampact.config.yaml: OpenAPI only, no code generated
openapi:
  billing: openapi/billing.yaml
checks: { openapi: warning }                         # report drift without failing
```

```yaml
# a Spring Boot app's seampact.config.yaml, or the same keys in the plugin's DSL (A42)
outDir: build/generated/sources/seampact/main        # Gradle's habit; not committed
targets:
  - use: 'io.github.jubasse:seampact-spring-boot'    # handled by the Gradle or Maven plugin
    api: tasks
    options: { package: com.acme.tasks.api, springSecurity: { matchers: true } }
    artefacts: { accessHooks: false }
    access: { native: "Spring Security's own rules guard this service; seampact exports each route's access." }
checks: { generated: disabled }                      # the output is not committed
```

Rules:
- The root config takes `apps` (the app directories), `sources`, `allowLocal`, `openapi` (merged documents, below) and `checks`. An app config takes `outDir`, `sources`, `targets`, `openapi`, `checks` and `allowLocal`.
- `outDir` is the one directory of the app's generated code ([A41](../decisions.md#a41)), `__generated__` at the config's directory by default; a JVM app may name its build directory instead (`build/generated/sources/seampact/main` for Gradle, `target/generated-sources/seampact` for Maven) and leave the output uncommitted. A target's `out` is relative to it and defaults to the entry's `id` (or the target's name), so generated code never mixes with the developer's. An app inside a root's `apps` sees the root's sources beside its own; a name defined in both is an error naming both files. An app config outside any root, or run on its own, uses only its own sources.
- A target entry takes `id`, `use`, `api` or `apis`, `document`, `out`, `link`, `artefacts`, `options`, `operations`, `allowUntested` and, for a server target, `mount`, `access`, `frameworkRoutes` and `frameworkDocs`.
- `options` holds the target's own options (the naming options of ADR 0007, `hooks`, `additionalMember`, formatting, `springSecurity`...), validated against the schema the target publishes.
- `operations: { include: [...], exclude: [...] }` keeps or drops operations by tag or operation id, so an app that serves part of an api says so here, not in the contract; the boot check expects handlers for the kept operations only (ADR 0012).
- `mount` is the path prefix the framework adds before every contract path (a NestJS global prefix, a Laravel route group prefix, a servlet context path, API Platform's route prefix), empty by default; the boot check refuses a framework whose prefix differs (ADR 0012).
- `access: { native: "<reason>" }` states that the framework's native security enforces access, which `artefacts: { accessHooks: false }` requires; see ADR 0012 "Native access instead of hooks".
- `allowUntested: [nestjs@13]` accepts a framework major the compatibility matrix has not tested, silencing its warning (ADR 0009).
- `api` names an api by its name alone when no other source the app sees holds an api of that name, and as `<source>/<api>` otherwise. `apis` lists several, generated each under `<out>/<api>`, so one app serving a public and a service api writes one entry per target kind; a link between two entries with `apis` pairs each api with the same api.
- `document` names one of the api's documents (ADR 0002 section 5): the target generates only the operations that document holds, so a client generated from the `public` document leaves the `internal` routes out.
- Paths (`path` sources, `out`, the `openapi` paths) are relative to the config file that writes them.
- Only the sources an app uses (by a target, an `openapi` entry or a check) are resolved and checked: a root's `path` source that an app with `allowLocal: false` never names does not fail it.
- `use` is an npm package name, a Maven `group:artifact` coordinate or a Composer `vendor/name`. Each runner handles the entries of its ecosystem and leaves the others; the forms cannot be confused.
- `artefacts` switches each artefact a target declares on or off (types, validators, route table, handler interfaces, utilities, access hooks, boot check, client, query hooks, native docs; ADR 0009). Each artefact follows its target's declared default: everything is on by default, except `nativeDocs`, off unless its target declares it on. A key the target does not declare is refused naming the declared ones (`config.artefacts.unknown`), turning off an artefact another enabled one needs is refused naming both (`config.artefacts.needed`), and an entry with every artefact off is refused, since it would generate nothing (`config.artefacts.none`). `bootCheck` also takes `{ handlers, frameworkRoutes }` to switch those two checks apart (ADR 0012); a target that declares its tunable boot checks without a `bootCheck` artefact takes `bootCheck: false` as switching them all off. `accessHooks: false` needs `access: { native }`.
- `openapi` maps an api to the path of its one document, or to a mapping from each of its documents (ADR 0002 section 5) to a path; `openapi: none` writes no seampact document. Without the key, an app with a server target writes seampact's documents of every api its server targets generate from, at `openapi/<api>.yaml`, or `openapi/<api>.<document>.yaml` for an api that declares `documents` ([A43](../decisions.md#a43)); an app with no server target (a frontend with client targets only) writes none unless its `openapi` lists them. A path may be replaced by `{ path, extensions, reasons, inputSchemas, servers }`, the emitter options of ADR 0004 section 12: `extensions` is `all` (the default), `none` or a list of extension names (`access`, `paging`, ..., the names after `x-seampact-`); `reasons` is `include` (the default) or `omit`; `inputSchemas` is `shared` (the default) or `strict`; `servers` is OpenAPI's list. The options are app configuration, since they shape a rendering and name deployments, never the contract ([A40](../decisions.md#a40)). An app config with `openapi` and no `targets` generates the documents and no code: an OpenAPI-only setup is a first-class one (A37). `checks.openapi` checks every document the app writes for drift, and `checks.generated` the committed generated files (ADR 0015); each is `error` (the default: a drift fails `check`), `warning` (reported, `check` passes) or `disabled`.
- `frameworkDocs` is `keep` (the default) or `off`; see "Which OpenAPI documents exist" below.
- `frameworkRoutes` is the allow-list of framework routes outside the contract that the boot check accepts, each with a reason (FR-25, ADR 0012); `path` may be a pattern, `*` matching one segment, `**` any number (`/actuator/**`), and a `*` inside a segment any characters but `/`, none included (`/livewire-*/**`), so a library that registers many routes takes one entry. A catch-all route (`/files/*rest`, `:path*`) matches only `**`, never `*` or a literal segment. An entry that writes `frameworkRoutes` while `artefacts.bootCheck` or `artefacts.bootCheck.frameworkRoutes` is false is refused (`config.key.conflict`), since the allow-list would be dropped.
- The config is validated against the compatibility matrix before anything is generated (ADR 0009); `checks.matrix` is `warning` (the default: a framework version the matrix has not tested is reported and `check` passes) or `error` (such a version is refused), the values `checks.openapi` and `checks.generated` use; it has no `disabled`, since `allowUntested` already silences one framework major. A version the matrix records as incompatible is always refused. The installed version is read from the framework's `package.json` in the `node_modules` directories from each entry's output directory up, where the generated code resolves its imports, a pre-release counting as its major; a framework package not installed is refused with its install command, since the generated code imports it, and a Yarn Plug'n'Play project, which has no `node_modules`, is refused by name (`config.matrix.pnp-unsupported`). The Gradle and Maven plugins read the Spring Boot version from the resolved compile classpath (Gradle `compileClasspath`, Maven project dependencies) and check it against the JVM targets of the same matrix data, with the same codes, `checks.matrix` and `allowUntested` (`spring-boot@<major>`).
- On the JVM the same keys, with the same schema, may be written in the plugin's DSL instead of the file: `seampact { ... }` in Gradle, `<configuration>` in Maven ([A42](../decisions.md#a42)). One app has one source: a `seampact.config.yaml` beside a DSL configuration is an error naming both. The schemas every runner validates are published as `@seampact/spec/schemas/config/app.schema.json` and `root.schema.json`; so that each value has a DSL form, their fixed keys are identifiers, user-named keys are map keys under a name pattern, and alternatives differ by JSON type or by a required key, never by a number against a string or by a pattern. The build files also hold the binary pin (ADR 0010).

`warnings.ignore` silences generate warnings of a target by form or full code, and `generate --force` overwrites or removes a generated file edited by hand while keeping every other writer refusal.

### Which OpenAPI documents exist

Which documents exist is the user's choice, for every target alike, API Platform included (A43, which lifts [A15](../decisions.md#a15)'s and [A28](../decisions.md#a28)'s "API Platform's own OpenAPI stays off"). Per app:

| The app wants | `openapi` | `artefacts.nativeDocs` |
|---|---|---|
| seampact's documents only (the default for an app with a server target) | absent, or the documents it lists | off (the default) |
| the framework's own document, completed by codegen | `none` | on |
| both, agreeing on every contract route (ADR 0015) | the documents it lists | on |
| none | `none` | off |

An app with client targets only writes no document by default; it writes those its `openapi` lists.

seampact's documents are written from the IR through ADR 0004 section 12, with the emitter options above. `nativeDocs` (ADR 0009) generates the framework's own annotations or metadata for the contract routes, so the framework's document describes them as seampact's does. With `nativeDocs` off, the target generates nothing for the framework's document and leaves the framework's own generation as the framework has it: an API Platform app serves API Platform's document of its resources by default, and a NestJS app that calls `SwaggerModule.setup` keeps serving its document; that document is then the framework's own view, and nothing checks it against the contract. seampact turns it off only when the app asks: `frameworkDocs: off` on the server target entry makes the target write the framework's or its documentation library's own switch (API Platform's `enable_swagger: false`, which keeps the Hydra documentation the api-platform pack links to, ADR 0008; springdoc's `springdoc.api-docs.enabled: false`) into a generated configuration file the app loads. A target that knows no such switch for its framework refuses `off`, naming the fix: nestjs, whose document exists only where the app calls `SwaggerModule.setup`, answers "remove the setup". `off` beside `nativeDocs: true` is refused too, naming both.

While a framework's own document is on, its routes (API Platform's documentation and entrypoint routes, springdoc's configured paths) are framework routes like any other for the boot check (ADR 0012): the target accepts those it reads from the framework's own configuration and lists them in the boot check's report, and a path the app chooses in code (`SwaggerModule.setup('docs', app, ...)`) goes into `frameworkRoutes`.

A monorepo's root config may also write merged documents with seampact, in its own `openapi` key: each entry names a document and takes `path`, `apps` (the app directories it covers, every app of `apps` by default), `prefix` (per api, a prefix for its operation ids and component keys), and the emitter options above. An app contributes the operations its server targets generate, through their `api` or `apis`, `document` and `operations`; an app with an `openapi` key and no target (an OpenAPI-only setup) contributes the documents its `openapi` lists; only an app with client targets and no server target contributes nothing, since it serves no route, even when its own `openapi` lists documents, which it writes for itself only. Each api is therefore taken from the apps that serve or document it, and an api two such apps provide is written once, with the union of their operations. Elements of different apis are merged as ADR 0004 section 12 says: an identical element is written once, and two different elements under one name are refused, naming both apis, both elements and the fix (a `prefix` for one of the apis), as are two operations with the same method and path. Each app keeps its own documents, from seampact, from its framework or none, as its own config says: the merged document is one more seampact document, never a replacement. `generate` and `check` at the root write and check the apps, then the merged documents; run in one app, they handle that app only, and deleting the root config removes the merged documents and nothing else. The root's `checks.openapi` checks the merged documents for drift, with the same values and default as an app's.

Several apps that contribute parts of one api id merge into it when they share its version; two different apis under one id are refused by their element clashes, with a fix naming distinct api ids. With the `apis` extension deselected, an api's version, docs and consumer extensions are left out like any deselected extension. A merged document written outside the root's directory and then dropped is not swept.

A contract workspace that relays to an api it does not compile names it in `workspace.imports` (ADR 0002 section 1). Such an entry takes the source forms of `sources` above, plus `api` (the api's name inside the bundle) and `integrity`, which is required there; it goes through the same pinned-bundle check.

### The pinned-bundle check

Before generating, and in `seampact check`, a runner verifies a bundle source:
1. every file's hash matches the manifest;
2. the manifest's integrity matches the `integrity` pinned in the config;
3. each IR file validates against the IR JSON Schema of its declared version.

The config schema accepts a bundle source without `integrity`, so pinning is a copy: leave the key out, run `seampact check`, copy the value it prints. A missing pin, or one that differs from the manifest's integrity, fails and prints the actual value; a file whose hash differs from the manifest fails, naming the file. Native plugins run the same three steps in Kotlin or PHP.

Relays (FR-8) may point at an api in a pinned bundle, named in `workspace.imports` (ADR 0002 section 1): workspace compilation reads that bundle's IR, after the same check, to copy the public operation into the relay route and check the superset (ADR 0002 section 7).

### Refusing local sources on shared branches

`allowLocal` (in the root or the app config, the app's winning) defaults to `true`. When it is `false`:
- a `path` source fails `compile`, `generate` and `check` with a diagnostic naming the source and the fix (use a pinned bundle);
- a `package` source that the package manager resolved from a local path (`file:`, `link:` or a workspace link) fails `check`;
- a `git` source whose URL is a `file:` URL or a local path fails `compile`, `generate` and `check` as `bundle.source-local`, even when its bundle is cached;
- a `maven` source that the build resolves from `mavenLocal()` or a `file:` repository fails `generate` and `check` as `bundle.source-local`, even when its bundle is cached.

The environment variable `SEAMPACT_ALLOW_LOCAL=false` forces the refusal regardless of the file, and can never turn it off. CI sets it on shared branches; a developer keeps local sources on a feature branch.

### Unpublished installs for test consumers

Test consumer projects live in `~/Dev/test-seampact-<name>` or a temporary directory, never in the monorepo (A12), and install exactly as a user would (FR-36):

| Ecosystem | How the unpublished packages are installed |
|---|---|
| npm | `pnpm pack` writes a tarball per package; the consumer's `package.json` lists the tarballs, and an `overrides` entry (pnpm 11 and later read it from the consumer's `pnpm-workspace.yaml` only, not from the `pnpm` field of `package.json`) maps every `@seampact/*` package to its tarball so transitive dependencies resolve to tarballs too |
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

- FRs: FR-17, FR-36, FR-8 (relays to a pinned bundle), FR-11 (committed document checks and emitter options), FR-25 (framework route allow-list, native access); amendments A3, A9, A12, A26, A37, A40, A41, A42, A43 (which documents exist, merged documents).
- Checklist items enabled: CHK-052 (relays across a pinned bundle), CHK-059 (committed and drift-checked documents), CHK-063 (framework routes allow-listed with a reason), CHK-070 (test consumers), CHK-072 (unpublished installs), CHK-076 (native consumers read bundles), CHK-088 (PHP trees installable through path repositories), CHK-113 and CHK-114 (per-app configs, artefact switches, OpenAPI-only setups), CHK-136 (emitter options), CHK-141 (untested versions), CHK-147 (boot-check knobs, operations filter), CHK-154 (`outDir`), CHK-161 (`mount`), CHK-163 (native access), CHK-165 (`nativeDocs`), CHK-166 (JVM DSL), CHK-170 (the per-app document choices, `frameworkDocs`), CHK-171 (merged documents in the root config).
