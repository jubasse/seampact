# ADR 0009: Modular packaging and target composition

Status: accepted

## Context

Modularity is a hard condition (amendment [A2](../decisions.md#a2)): installing seampact gives the YAML and IR core only. Each codegen target, and each runtime helper of a target, is a separate package the consumer adds explicitly. The CLI never depends on or bundles a target. Library integrations are optional adapters, never required by a target ([A25](../decisions.md#a25)), and the core imposes no wire format or library ([A30](../decisions.md#a30)).

Targets still have to compose: the NestJS target needs validators, and the React target needs a client. If composition went through package dependencies, installing `@seampact/codegen-nestjs` would pull a validator the consumer did not choose. FR-39 asks for a provider seam instead.

This ADR fixes the package list, the allowed dependency directions, how the CLI finds targets, how targets compose, and what generated code may depend on at run time.

## Options

- Packaging: one `seampact` package holding every target, or one package per role. Choice: one per role (A2), so installing the core installs no target, helper or adapter.
- Composition: a target depending on the targets it needs (nestjs on a validator target), every target bundling each validator library it supports, or descriptors exchanged through a provider seam in codegen-core. Choice: the provider seam (FR-39). A dependency pulls a validator the consumer did not choose, and bundling grows every target with each library.

## Decisions

### Package roles

Every package has exactly one role. The role is recorded in its manifest (a `seampact.role` field in `package.json`, and the equivalent metadata in the Gradle and Composer builds) so CI can check the dependency rules below.

| Role | What it is | Installed by the consumer when |
|---|---|---|
| core | the compiler, emitters and CLI | always |
| target | a generator for one framework or language | they generate for that framework |
| hooks | the runtime interfaces generated server code implements against | they generate a server boundary |
| helper | an optional runtime implementation behind a generated interface | they want that implementation |
| adapter | an optional integration of a library behind the neutral hooks | they use that library |
| pack | a data-only convention pack (ADR 0008) | their contract applies it |
| tool | test infrastructure, never a dependency of a product package | they run the conformance suite |

### Package list for 1.0

npm, scope `@seampact` ([A1](../decisions.md#a1), [A27](../decisions.md#a27)):

| Package | Role | Content |
|---|---|---|
| `spec` | core | authoring JSON Schemas, one per file kind and per fragment kind, for editor modelines (ADR 0002 section 3), IR JSON Schema and TypeScript types, pack and app-config schemas, naming algorithm and vectors, the compatibility matrix |
| `compiler` | core | loader, pass pipeline, packs, workspace mode, bundle writing and verification |
| `openapi` | core | OpenAPI 3.1 emitter and the JSON Schemas of the `x-seampact-*` extensions it writes, one per row of the OpenAPI mapping (ADR 0004 section 12) |
| `lint` | core | lint plugin API and core rules |
| `diff` | core | compatibility classifier and release gate |
| `codegen-core` | core | `defineTarget`, file writer, formatting hook, provider seam, version checks |
| `cli` | core | `init`, `compile`, `check`, `lint`, `diff`, `generate`, `bundle`, `explain`; `compile --editor-schemas` writes the workspace's editor schemas into the directory `workspace.editorSchemas` names (`.seampact/schemas` by default), which no package ships |
| `codegen-ts`, `codegen-zod`, `codegen-yup`, `codegen-class-validator`, `codegen-fetch` | target | types, validators, typed client (FR-15) |
| `codegen-nestjs`, `codegen-fastify`, `codegen-express`, `codegen-adonis`, `codegen-hono` | target | server boundaries (FR-16, FR-19) |
| `codegen-react`, `codegen-angular`, `codegen-vue` | target | frontend clients (FR-19) |
| `hooks` | hooks | access hook interfaces, decision and subject types, store and redaction interfaces, the three-state `Field` type of ADR 0003 section 5; types only |
| `nestjs-casl` | adapter | CASL behind the decide hook ([A24](../decisions.md#a24)) |
| `pack-crud-rights`, `pack-api-platform`, `pack-laravel`, `pack-spring`, `pack-jsonapi`, `pack-hal` | pack | ADR 0008 (A24, [A28](../decisions.md#a28), [A32](../decisions.md#a32)) |
| `http-suite` | tool | the shared black-box HTTP suite (ADR 0015) |

Optional runtime helpers are named `@seampact/<concern>` when they work with every server target of the ecosystem (for example `@seampact/signed-webhooks`, `@seampact/idempotency-memory`) and `@seampact/<framework>-<concern>` only when framework glue is unavoidable. Each target adds the helpers it needs, under these names and rules.

JVM, groupId `io.github.jubasse` (A27), and Composer, vendor `seampact`: the IR model, the hooks interfaces, the plugins and the PHP targets are listed in ADR 0010. Their roles follow the same table.

The standalone compiler binary (ADR 0010) is a release asset, not a package.

### Dependency rules

1. A core package depends only on core packages and third-party libraries. It never depends on a target, hooks, helper, adapter or pack.
2. A target has `@seampact/codegen-core` and `@seampact/spec` as peer dependencies, so it binds to the copy the CLI uses, and depends on no other seampact package. A target never depends on another target, a helper or an adapter.
3. `hooks` depends on nothing.
4. A helper depends on `hooks` and third-party libraries only.
5. An adapter depends on `hooks` and has its library as a peer dependency. No target depends on an adapter.
6. A pack depends only on the packs it extends.
7. A tool may depend on anything; no product package depends on a tool.

A CI script reads every package manifest of the monorepo (npm, Gradle, Composer) and fails on a dependency that breaks these rules. The same check runs on packed installs (FR-36, ADR 0011): in an empty directory, installing the `@seampact/cli` tarball must install exactly the core packages; installing `@seampact/cli` and `@seampact/codegen-nestjs` must add only `codegen-nestjs` and its third-party dependencies, with no validator target, no hooks package, no helper and no adapter.

What the two required installs pull, by construction:

```text
@seampact/cli
  -> compiler, openapi, lint, diff, codegen-core, spec   (all core)
  -> third-party: yaml, ajv, ...
@seampact/codegen-nestjs
  -> peer: codegen-core, spec                            (already installed with the CLI)
  -> third-party: the pinned formatter
  (no codegen-zod, codegen-class-validator, codegen-yup, hooks, helper or adapter)
```

### Target resolution from the app config

The CLI reads the app config, `seampact.config.yaml` (ADR 0011). For each target entry it resolves the named package from the consumer project, starting at the config file's directory, never from the CLI's own install location. A globally installed CLI therefore still uses the project's pinned targets.

- A missing package fails `generate` with a diagnostic naming the package and the install command for the project's package manager.
- Each target exports its metadata: name, the irVersion range and, before 1.0, the exact irRevision it reads (ADR 0005), the codegen-core API range, the `hooks` range of the code it emits, and the link kinds it provides or consumes. The CLI refuses a mismatch before calling `generate`, naming both versions.
- A target receives each api's IR in its serialised member order (ADR 0004 section 10), whether the source is a `path` compiled in the run or a bundle, so the same contract generates the same files from either.
- A target entry whose `use` is a Maven coordinate or a Composer package belongs to a native runner (ADR 0011); the Node CLI leaves it to that runner.

### The provider seam

Targets compose through descriptors, never through package dependencies (FR-39).

- A validator target (`codegen-zod`, `codegen-yup`, `codegen-class-validator`) provides a `validators` descriptor: its style (`standard-schema` or `class-validator`), the runtime libraries the generated code imports, and, for each schema id and direction, the module path and export name of the generated validator. In both styles each export is a Standard Schema v1 value, in `class-validator` an adapter over a decorated class, so a consumer reads both alike. The layout, the wire checks and the plan of each type use with its refusals are shared in `@seampact/codegen-core/validators`, so every validator target refuses the same forms.
- A types target (`codegen-ts`) provides a `types` descriptor (style `typescript`): for each schema id and direction, and for each operation its input, output and error union, the module path and export name of the generated type. The server targets and `codegen-fetch` consume it, so no target re-emits another's types.
- A client target (`codegen-fetch`) provides a `client` descriptor: the module path and factory export of the generated client and the method name of each operation.
- A consumer target declares the link kinds it needs and the styles it accepts. Validators are offered per framework compatibility: `standard-schema` (zod, yup) on every Node server target, `class-validator` on `codegen-nestjs` only. `codegen-nestjs` accepts both validator styles; `codegen-fastify` accepts `standard-schema`, or with no link generates one Ajv validator per operation from the IR's JSON Schema, covering path, query, headers and body together, with the boundary's own options (`allErrors`, no type coercion, no removal of additional properties) and run in its `preValidation` hook, never Fastify's per-part route `schema`, which checks each part in turn, stops at the first failing one and by default coerces types and removes unknown keys; `codegen-express`, `codegen-hono` and `codegen-adonis` accept `standard-schema` (zod or yup), and `codegen-adonis` will also generate VineJS validators itself, strict input included, with no validator link, later; `codegen-react` and `codegen-vue` need a `client` link, and `codegen-angular` uses `HttpClient` and takes none.
- The app config links entries by id (ADR 0011). The CLI asks each provider for its descriptor, a pure function of the IR and the provider's options, then passes the descriptors to the consumer target's `generate`. Import paths between output directories are computed as POSIX relative paths, or taken from an explicit module specifier in the config when the outputs live in different packages.
- A link to a provider of the wrong kind or style fails `generate` with a diagnostic naming both entries, and its fix names the first-party packages of every style the consumer accepts (`codegen-zod` or `codegen-yup` for a Standard Schema consumer). The link check of `@seampact/codegen-core` reads those packages from the compatibility matrix below.

The same IR therefore generates a NestJS boundary with zod or with class-validator by changing one link (CHK-081), and a native target uses the same idea inside its own plugin.

### Artefacts and the compatibility matrix

The app config selects finely what is generated for an app ([A37](../decisions.md#a37)): which targets, in which combination (nestjs with zod, nestjs with class-validator, react with fetch), and per target which artefacts.

- Each target declares its artefacts in its metadata, each on by default except `nativeDocs`. For a server target: types, validators it consumes, route table, handler interfaces, utilities (the per-operation decorators, annotations, attributes, middleware, guards, interceptors, argument resolvers and FormRequests that place the check order around the developer's controller; no target generates the controller, [A41](../decisions.md#a41)), access hooks, boot check, and `nativeDocs`; for a client target: client, query hooks. The app config turns any of them off. Turning off an artefact that another enabled artefact needs (handler interfaces without types, utilities without the route table) is refused, naming both.
- `nativeDocs`, off by default, generates the framework's own OpenAPI annotations or metadata for contract routes, for a developer who wants the framework's document, beside seampact's or instead of it: the `@nestjs/swagger` decorators (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiSecurity`) and DTO schemas in nestjs, springdoc's `@Operation` and `@ApiResponse` in spring-boot, API Platform's own document completed in api-platform, and for laravel, adonis and symfony the common native generator where one exists (Scramble, NelmioApiDocBundle and the like), never imposing one. Which documents an app writes is its own choice, for every target alike ([A43](../decisions.md#a43)): seampact's, the framework's completed by `nativeDocs`, both or none, and a monorepo root may merge the apps' documents into one (ADR 0011). With `nativeDocs` off, a target leaves the framework's own generation as the framework has it, API Platform's included, unless the target entry asks for `frameworkDocs: off`. When both documents are emitted, they agree on operation ids, response codes and schemas for every contract route (CHK-165).
- An app config with an `openapi` key and no target generates those documents only, with no codegen package installed: a first-class setup, not a degraded one. An app may equally write no document (`openapi: none`).
- `@seampact/spec` publishes the compatibility matrix as data (`@seampact/spec/compatibility`): every first-party target, validator, client, adapter and pack, the link kinds and styles each provides or accepts, the formats and packs each target renders, and, per framework and library, the versions each target supports and those known to be incompatible, recorded apart (for example the NestJS, Spring Boot or Laravel majors). Native plugins carry the same data as a file. Today it records the first-party validator and types providers with their kind and style, and for each Node server target its framework (the id `allowUntested` names and the package whose installed version is read), the majors a consumer project tests it on, each with that consumer's id (NestJS 12, Express 4 and 5, Fastify 5, AdonisJS 6 and 7, Hono 4), the majors known to be incompatible with their reason (none yet), the validator styles it accepts and the validators it will generate itself, recorded as planned and not offered (Ajv on fastify, VineJS on adonis); it derives the offered target, framework major and validator pairs that tests and benchmarks run. Clients, adapters, packs, formats and the file for native plugins join as their first reader lands.
- Before generating, the CLI and the native runners validate the app config against the matrix and against the framework versions installed in the app. An incompatible combination (`codegen-fastify` linked to `codegen-class-validator`, a framework major the matrix records as incompatible, a pack its target cannot render) is refused before any file is written, with a diagnostic naming the working alternatives (`codegen-zod` or `codegen-yup`, the supported majors). A framework version the matrix does not list, such as a major released after the target, is only a warning naming the supported ones: an untested version is not known to be broken, and refusing it would stop the app's framework upgrades until a seampact release. `checks.matrix: error` refuses it (the default is `warning`), and a target entry's `allowUntested: [<framework>@<major>]` accepts it without the warning (ADR 0011).
- A third-party target or adapter declares the same data in its own metadata, and the CLI merges it with the matrix, so the check needs no core release.
- Formats and paging styles are templates in the IR (ADR 0004 section 8), not per-target code: every first-party target renders the default format and every format and paging style the template language expresses, the first-party presets and the contract's own alike ([A17](../decisions.md#a17), [A31](../decisions.md#a31)). The matrix records, per target, the framework mechanism it maps them onto (ADR 0008). A third-party target may render fewer, declares which, and `generate` refuses one it cannot render by name (FR-14). The README publishes the matrix as a table.

### What generated code depends on at run time

- Generated client code imports its framework (Angular `HttpClient`, TanStack Query) and nothing from seampact.
- Generated server code imports its framework, the validator library of its link, and `@seampact/hooks` (or the Java and PHP hooks package). It never imports a generator, a helper or an adapter. The target option `hooks: vendored` generates the hook interfaces and runtime types into the app's own namespace instead, so the app depends on no seampact package at run time ([A40](../decisions.md#a40)); `package`, the default, is required with an adapter, since the adapter implements the package's interfaces, and `vendored` with an adapter is refused naming both.
- Everything contract-specific, and the behaviour the boundary must have (conditional GET, projection, stripping, envelopes or problem+json, the check order), is generated into the consumer's tree, not loaded from a runtime package. The `hooks` package holds interfaces and types only, so a generated boundary runs with no seampact behaviour code.
- `hooks` exists because adapters must implement the same interfaces in every application. TypeScript could rely on structural typing, but Java and PHP are nominal, and one shared definition per ecosystem keeps the three in step. It is semver-versioned on its own; each server target declares the major it emits against, and `generate` checks the installed one.

A target maps the contract onto its framework's idiomatic mechanisms (A30): NestJS composite decorators, guards, param decorators and exception filters; Fastify hooks and route config; Spring composed annotations, interceptors, argument resolvers and `ProblemDetail`; Laravel routes, middleware, Form Requests and API Resources; Symfony attributes, listeners, value resolvers and normalizers; API Platform resource metadata, providers and processors. It places them around the developer's own controller, which implements the generated interface; no target generates the controller (A41, ADR 0012). Optional helpers and adapters plug into the framework's popular libraries; they never replace the framework's own mechanism.

### Repository layout

- npm packages: `packages/<group>/<name>` (`core`, `targets`, `packs`, `runtime`), the directory named after the package name suffix, one pnpm workspace (ADR 0001).
- JVM: one Gradle build under `jvm/`, one subproject per artifact.
- PHP: `php/<name>`, one directory per Composer package, each with its own `composer.json`; CI pushes each to its read-only mirror ([A19](../decisions.md#a19), ADR 0011).

## Consequences

- Installing the CLI pulls no target, runtime helper or adapter (SM-5 = 0); the claim is tested on packed installs, not workspace links.
- No 1.0 target needs an adapter or an authorization library to compile, boot or pass the HTTP suite (SM-8 = 0).
- A server consumer installs one more package than its target and runtime helpers: the `hooks` package. It is small, has no dependency and carries no behaviour, and an app without an adapter may vendor its types instead (A40).
- A bug in generated boundary behaviour is fixed by upgrading the target and regenerating, not by a runtime package update. This is the price of generated code that runs without seampact behaviour code.
- Every Composer package needs its own read-only mirror (A19 names the three targets): `seampact/ir`, `seampact/hooks`, `seampact/laravel-spatie` and the signed-webhook helper of ADR 0013 need one too.

## Traceability

- FRs: FR-14, FR-39, FR-25 and FR-26 (adapters optional and separate), FR-16 (runtime helpers, utilities around the developer's controller), FR-36 (checks on packed installs), FR-9 and FR-11 (published authoring and extension schemas, native docs); amendments A2, A24, A25, A27, A30, A32, A37, [A38](../decisions.md#a38), A40, A41, A43.
- Checklist items enabled: CHK-071 (the CLI pulls no target and names a missing one), CHK-077 (version ranges checked), CHK-081 (nestjs with zod and with class-validator), CHK-096 and CHK-097 (adapters as separate packages), CHK-098 (a target passes with no adapter installed), CHK-107 (format packs), CHK-114 and CHK-115 (artefact switches, OpenAPI-only setups, the compatibility matrix), CHK-120 (the published `x-seampact-*` schemas), CHK-122 (editor schemas), CHK-123 (`explain`), CHK-141 (untested versions), CHK-148 (vendored hooks), CHK-154 and CHK-155 (utilities around the developer's controller), CHK-165 (`nativeDocs`), CHK-170 (document choices per app).
- Success metrics: SM-5, SM-8.
