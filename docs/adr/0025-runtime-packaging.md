# ADR 0025: Runtime packaging

Status: accepted

## Context

Every server target copies its boundary runtime into the app's tree, once per api, as ADR 0009 "What generated code depends on at run time" and ADR 0015 "Runtime helpers" require: generated server code imports no seampact behaviour code at run time. The idiom audits of the Laravel, Symfony and NestJS targets found the cost of that rule:

- Laravel copies 79 runtime files, about 9,500 lines, into `Laravel\Runtime` of each api (ADR 0023 "Placement").
- Symfony copies 71 files, about 6,400 lines, into `Symfony\Runtime` of each api (ADR 0024 "Placement"). Each api also generates its own `SeampactOperation` attribute, which IDE auto-import confuses when an app has two apis.
- NestJS copies about 120 KB per api: the 1,417-line `nestjs-boundary.ts`, the 70 KB `routes.ts` and the `node-server/` modules. Every api exports a class named `SeampactModule`.
- Pint, Larastan, Rector, PHP-CS-Fixer, Deptrac, ESLint, `nest build` and coverage tools all scan the copied code. A tool that rewrites files (Rector, a fixer) makes `seampact check` report drift.
- Two apis mean two full copies.

How each target copies today:

| Target | Runtime source | Destination per api | Rewrite |
|---|---|---|---|
| Express, Fastify, NestJS, Adonis | `packages/core/codegen-core/node-server-runtime/`: 27 neutral modules and 5 `node-*` modules, plus the target's placement file `packages/targets/codegen-<target>/runtime/<target>-boundary.ts` | `<api>/node-server/` and `<api>/<target>-boundary.ts` | none: the app compiles the TS sources |
| Hono | the same 27 neutral modules, 5 `web-*` modules and `hono-boundary.ts` | `<api>/web-server/` | none |
| Laravel | `php/codegen/runtime/` (shared) and `php/laravel/runtime/` | `<ns>\Laravel\Runtime` | namespace line rewritten, the shared runtime's `use` lines dropped, any other seampact reference refused |
| Symfony | `php/codegen/runtime/` and `php/symfony/runtime/` | `<ns>\Symfony\Runtime` | as Laravel |
| Spring Boot | 43 classes in `jvm/seampact-spring-boot/src/main/resources/seampact-spring-runtime/`, plus `SpringDataPages` and `SecurityRefusals` when used | `<package>.spring.runtime` | `package` line rewritten |

Adonis also copies `runtime/vine-support.ts` of its package as `validators/vine-support.ts`, the VineJS module its validators share.

The runtime is already contract-neutral: the Node targets copy it unchanged, Spring rewrites the `package` line, and PHP rewrites the namespace line, drops the shared runtime's `use` lines and refuses any other seampact reference. Three behaviours depend on per-api copies:

- a NestJS `ContractException` of one api, thrown on a route of another, matches neither api's filter (ADR 0016 "Amendment 2026-10-27: NestJS idioms on the boundary");
- the Symfony operation attribute is a class of each api;
- the unexpected-error listener is looked up by its runtime class: Laravel resolves the container key `UnexpectedErrorListener::class`, Symfony the service of that class, and Spring every bean of that type. Each api's copy is another class, so each api finds its own listener.

The front targets copy a small front runtime too (ADR 0021). They are out of scope: client code imports nothing from seampact, and no audit flags it.

Laravel's namespaces are decided here as well, since they also set where generated code lives and change for free only before 1.0. A Laravel controller method touches three namespaces today: `<ns>\Laravel\UpdateTaskRequest` (the FormRequest), `<ns>\UpdateTaskResult` and the errors (root), and `<ns>\Schemas\Task`. The sample `TasksController` has 33 `use` lines.

## Options

Packaging:

- A. Copy per api, as today.
- A+. A, plus the hygiene the audits propose: `init` writes the PHP tools' exclusions, the guides list ignore globs, NestJS module names are set per api.
- B. A dedicated runtime package per ecosystem: `@seampact/server-runtime` on npm, `seampact/runtime`, `seampact/laravel-runtime` and `seampact/symfony-runtime` on Packagist, `seampact-spring-runtime` on Maven Central.
- C. One copy per app, shared by every api under the target's output directory.
- D. B for Node and Spring; in PHP, the existing target packages carry the runtime.
- F. Package the neutral core, keep copying each framework's placement file.

Version guards the package options combine:

- G1 lockstep: a runtime package always has its generator's version.
- G2 generate-time check: the target reads the installed runtime's version and refuses another `major.minor`, or a patch below its own.
- G3 boot check: the generated code carries the generator's version, and the runtime refuses to start on another `major.minor` or a lower patch.
- G4 declared range: a peer range or a `require` at `self.version`.
- G5 manifest: the generation manifest records the runtime version and `seampact check` compares it in CI.

Laravel namespaces:

- N0. Keep the split; the guide shows an import alias.
- N1. Move the classes a handler names into the operation's root namespace.
- N2. One namespace per operation (`<ns>\UpdateTask\{Request,Input,Result}`).

Choice: D with G1, G2 and G3, no copy mode at 1.0, and N1.

## Decisions

### The runtime packages

The runtime leaves the generated tree and ships in one versioned package per ecosystem. Generated server code imports it as it imports the hooks package.

| Ecosystem | Package | Holds | Generated code imports |
|---|---|---|---|
| Node | `@seampact/server-runtime`, from `packages/runtime/server-runtime` | the 27 neutral modules at the root export; `/node` and `/web` for the transport modules; `/express`, `/fastify`, `/nestjs`, `/adonis` and `/hono` for the placement files | Express: the root, `/node`, `/express`. Fastify: the root, `/node`, `/fastify`. NestJS: the root, `/node`, `/nestjs`. Adonis: the root, `/node`, `/adonis`. Hono: the root, `/web`, `/hono` |
| PHP, shared part | `seampact/codegen` | `Seampact\Codegen\Runtime\`, autoloaded from `runtime/` as today | both PHP targets |
| Laravel | `seampact/laravel` | `Seampact\Laravel\Runtime\`, autoloaded from `runtime/` as today | `Seampact\Codegen\Runtime\` and `Seampact\Laravel\Runtime\` |
| Symfony | `seampact/symfony` | `Seampact\Symfony\Runtime\`, from `runtime/`, which its `composer.json` gains as an autoload root | `Seampact\Codegen\Runtime\` and `Seampact\Symfony\Runtime\` |
| Spring Boot | `io.github.jubasse:seampact-spring-runtime`, a Gradle subproject of `jvm/` built from today's runtime sources | the package `io.github.jubasse.seampact.springboot.runtime`, which those sources already declare | `io.github.jubasse.seampact.springboot.runtime` |

- `@seampact/server-runtime` ships built JavaScript, as an ESM and a CommonJS build behind the same subpath exports, with its type declarations. Each framework is an optional peer dependency, so an Express app installs no NestJS package. A NestJS app on CommonJS loads the CommonJS build.
- In PHP the generator and the runtime are one package at one version. A PHP app's production `vendor/` therefore holds the generator and its dependencies (`nette/php-generator`, `seampact/ir`, `seampact/codegen`). `seampact/laravel` is already a production `require`; `seampact/symfony` becomes one too, instead of `require --dev`.
- The runtime packages hold contract-neutral code only. Everything contract-specific stays generated into the app's tree, as ADR 0009 says.
- A class whose identity must tell two apis apart stays generated per api, as a thin subclass or a generated declaration: each NestJS api's `ContractException` subclass, which its filter alone matches, and its module class, whose class name carries the api's type name; the Symfony operation attribute; any class a filter, listener or resolver matches by type. ADR 0016's rule for a `ContractException` thrown on another api's route therefore holds.
- Every lookup the runtime makes by a class or a type is keyed per api. The unexpected-error listener, `UnexpectedErrorListener`, and the `UnexpectedFailure` it receives are generated per api as a declaration, or the runtime keys the lookup by the api, as the Laravel deciders' tags already are. A shared key would let the last api's binding win in Laravel and Symfony with no diagnostic, and would hand each Spring listener the other api's failures.
- The Spring runtime keeps the package its sources declare, `io.github.jubasse.seampact.springboot.runtime`, an exception to ADR 0010's `io.github.jubasse.seampact.<module>`: no generator jar is on the app's classpath, so the package is split across no jars.
- `seampact-spring-runtime` declares Spring Data and Spring Security as optional dependencies (Gradle `compileOnly`, Maven `<optional>`): `SpringDataPages` and `SecurityRefusals` load only in an app that uses them, as they are copied only then today.
- Optional helpers (ADR 0015 "Runtime helpers", the signed-webhook verifier) are unchanged: generated code never imports them.

### Version guards

G1, lockstep. Every runtime package is released with its generators at the same version; there is no separate runtime version line. Each ecosystem holds it by one mechanism:

- npm: a changesets `fixed` group holding `@seampact/server-runtime`, the CLI, codegen-core and the server targets, added with the v1 release pipeline. Today every package is `0.0.0` and no group exists.
- Composer: the generator and the runtime are one package, and `seampact/codegen` is required at `self.version`.
- Gradle: one version for `seampact-spring-runtime`, the plugins and the Spring Boot target, set by the `jvm/` build with the v1 release pipeline. Today the `jvm/` build sets none.

`hooks` keeps its own semver line (ADR 0009 "Target resolution from the app config"): each target still declares the `hooks` major it emits against, and `generate` still checks it.

G2, generate-time check. Before writing, a Node or Spring target reads the runtime the entry's output directory resolves: for Node, the package resolved from that directory, never from the target package (which may depend on another copy) or the config's directory; for Spring, the runtime on the classpath of the source set that compiles the generated code. It compares it with its own full version `<major>.<minor>.<patch>`:

- runtime absent: `runtime.missing`, "`<target> <version>` generates code that imports `<runtime package>`, which this app does not install." Fix: the install line of the ecosystem, at the generator's version (`npm install @seampact/server-runtime@<version>`; for Maven, the `<dependency>` block of `seampact-spring-runtime`).
- another `major.minor`: `runtime.version-mismatch`, "`<runtime package> <installed>` is installed, `<target> <version>` generates for `<major>.<minor>.x`." Fix: install the runtime at the generator's version, or move the generator to the runtime's version.
- the same `major.minor` with a lower patch: `runtime.version-mismatch`, "`<runtime package> <installed>` is older than the generator, `<target> <version>`." Fix: install the runtime at `<version>` or a later patch.
- no output directory in the generate request (a programmatic caller; `seampact generate` always gives it): `runtime.output-directory-missing`, "`<target> <version>` generates code that imports `<runtime package>` and checks the installed one from the api's output directory, which this generate request does not give (`outputDirectory`)." Fix: pass the api's output directory as `outputDirectory`. The check fails closed, never skipped.

A runtime patch at or above the generator's passes, so a runtime fix installs without regenerating. A runtime patch therefore reads every table its minor wrote: a field a patch adds to the generated code is optional, and the runtime keeps the old behaviour when it is absent. In PHP, G2 holds by construction (the generator is the runtime's package, and `seampact/codegen` is required at `self.version`), so the PHP runners run no check.

G3, boot check. The generated code of each api carries the generator's full version. The target's boot check (ADRs 0016 to 0024 "The boot check") compares it with the loaded runtime's version first, before any other check, in every ecosystem, PHP included, with G2's rule:

- `runtime.generated-for-other-version`, "The `<api>` boundary was generated by seampact `<version>`; the installed runtime is `<installed>`." Fix: run `seampact generate` again with the generator at `<installed>`, or install the runtime at `<version>` or a later patch of it.

Each runtime carries its own version as a constant in its sources, stamped by the release pipeline; G2 and G3 read that constant, never a package manifest: npm workspaces report `0.0.0`, and a Composer path repository reports `dev-*`. Unreleased, the constant holds a development version that the generators of the same checkout stamp into the code they write, so the sample apps pass the check against the runtime of their own checkout and are refused against a released one, and the reverse.

G3 catches an `npm update`, a `composer update` or a dependency bump run without regenerating, and a runtime pinned below the generator. The boot refuses; it never runs a boundary against another runtime.

G4 is how each ecosystem declares the dependency ("Consequences" below), not a separate guard. G5 is not adopted: G3 refuses the same skew at the app's start, in CI's tests too.

### No copy mode at 1.0

No option copies the runtime into the tree at 1.0. A `runtime: vendored` opt-in, as `hooks: vendored` is ([A40](../decisions.md#a40)), comes only if a user asks for it ([A47](../decisions.md#a47)); it is additive.

### Laravel namespaces (N1)

- The FormRequests (`<Op>Request`) move from `<ns>\Laravel` to the root namespace, beside the operation's `<Op>Input`, `<Op>Result` and errors. Any other class a handler's signature names goes there too.
- `<ns>\Laravel` keeps the wiring only: the provider, the middleware, the routes, `<Api>Boundary`, `<Api>Contract`, `<Api>Urls` and `<Api>RouteNames`.
- `<ns>\Schemas` stays apart: a schema `GetTasksBatchInput` sits beside the operation's `GetTasksBatchInput` in the reference contract. A controller then imports from two namespaces.
- The FormRequest keeps its name, the operation's segments plus `request`, and its claim through `ApiLayout::claim`, keyed by the full class name. In the root namespace that claim checks it against `<Op>Input`, `<Op>Result` and the errors, refused as `name.collision`; no naming role is added.
- Symfony is unchanged: its handlers take the root `<Op>Input`, and its `Symfony\` classes are wiring only.

## Consequences

Install and upgrade:

- Node: the app installs `@seampact/server-runtime` as a production dependency, beside the CLI and the target as dev dependencies. Upgrading moves all seampact packages to one version and regenerates; a runtime patch at or above the generator's installs without regenerating.
- Laravel: `composer require seampact/laravel`, as the guide already says. Symfony: `composer require seampact/symfony`, without `--dev`. `composer update` moves the generator and the runtime together; a minor or major upgrade regenerates, which G3 enforces at boot.
- Spring, Gradle: the plugin adds `seampact-spring-runtime` at its own version to the source set that compiles the generated code, and G2 checks the resolved version (a BOM or a forced version can change it). Spring, Maven: the app declares the `seampact-spring-runtime` dependency at the plugin's version; the generate goal checks it with G2.
- `vendor/`, `node_modules/` and the classpath are excluded by every linter, formatter, coverage tool and IDE by default, so no per-tool configuration covers the runtime. The generated tree shrinks to the contract-specific code, and two apis share one runtime.

What is no longer copied:

- `node-server/`, `web-server/` and `<target>-boundary.ts` under each Node api; `Laravel\Runtime` and `Symfony\Runtime` under each PHP api; `spring.runtime` under each Spring api.
- Adonis's `validators/vine-support.ts` stays generated: it belongs to the validators, beside the generated `validators/wire-checks.ts` it imports, and the validator modules are not the boundary runtime.
- `nodeServerRuntimeFiles` and its placement-file copy in codegen-core, `RuntimeCopy` in `php/codegen` and `RuntimeFiles` in the Laravel and Spring targets are removed, with `RuntimeCopyTest`.

Golden tests (ADR 0015 "Golden tests"):

- The four PHP golden trees (Laravel and Symfony, `Tasks` and `TasksConsistent`) lose their `Runtime` directories.
- Spring's golden tree loses `spring/runtime`; its golden source set compiles against `project(":seampact-spring-runtime")`.
- The Node reference and live-boundary tests compile the generated tree against the built package.
- Unit tests cover G2 (a generate refused for an absent runtime, another `major.minor` and a lower patch) and G3 (a boot refused for a foreign version) in each ecosystem. The rest of the runtime stays covered by the golden compile and the shared HTTP suite on each sample app, installed from the package. A CommonJS NestJS consumer joins the test consumers.

Publication ([A3](../decisions.md#a3)): nothing is published before 1.0, and the publication pipelines do not exist yet; they are prepared shortly before 1.0. They then add one npm package, `@seampact/server-runtime`, and one Maven Central artifact, `io.github.jubasse:seampact-spring-runtime`. Both use the accounts the other packages already need, the npm `@seampact` scope and the Central namespace `io.github.jubasse` (ADR 0010 "Namespaces"); no new Packagist package or read-only mirror ([A19](../decisions.md#a19)) is needed. Until 1.0 the sample apps install the runtime from a workspace, a path repository or an included build, as they install `hooks`.

After 1.0:

- The runtime's exported API is public and semver-bound in npm and on the JVM; in PHP, the runtime namespaces are.
- Going back to copying as the default would move imports, a breaking change; a copy mode stays possible as an opt-in.
- Splitting a PHP `-runtime` package out of a target later is not breaking: the namespaces stay, and the target `require`s the new package.

The remaining generated tree is still scanned by the app's tools, so `seampact check` still reports a rewrite by Rector or a fixer there; the audits' per-tool exclusions and `linguist-generated` are not decided here. Each Symfony api keeps its own `SeampactOperation` attribute, so the IDE auto-import confusion the Symfony audit found stays.

## Options rejected

- A: every audit finding stays, and switching the default to a package after 1.0 is breaking.
- A+: fixes the noise through per-tool configuration in three ecosystems; the size and the duplication stay.
- B: three more Packagist packages and their mirrors, for a PHP skew that D makes impossible; D can still become B later without breaking anyone.
- C: one copy per app still sits in linted paths, and the manifest must track files several entries own in three runners; entries pinned to different generator versions would write one directory.
- F: pays B's publication and skew cost while the largest file, NestJS's 1,417-line placement file, stays copied, and keeps two mechanisms.
- N0: leaves three namespaces per controller method.
- N2: changes every PHP target's naming for little gain.

## Delivery

| PR | Delivers |
|---|---|
| 1 | this ADR |
| 2 | `@seampact/server-runtime` with its ESM and CommonJS builds and subpath exports, G2 and G3 in codegen-core, Express and Hono importing it; the package joins `PACKED_PACKAGES` with a manifest form for the dual build; the G3 unit test, the Express and Hono test consumers, the HTTP suite. Until PR 3 the sources stay in codegen-core's `node-server-runtime/`, shipped by its `files`, where the copier of Fastify, NestJS and Adonis reads them, and the package builds them from there |
| 3 | NestJS (the per-api `ContractException` subclass and module name), Fastify and Adonis importing it; the sources move into the package and the copier is removed; `reference-boundary.test.ts`, `live-boundary.test.ts`, a CommonJS NestJS consumer, the HTTP suite. PRs 2 and 3 may be one PR under about 4,000 hand-written lines |
| 4 | Laravel namespaces N1; the Laravel golden trees, a `name.collision` test of a FormRequest against a root class, the sample app through the HTTP suite. It lands before PR 5, so the golden trees change once per concern |
| 5 | Laravel and Symfony importing `Seampact\Codegen\Runtime` and `Seampact\<Target>\Runtime`, the Symfony autoload root, the per-api identity classes and the per-api lookup of `UnexpectedErrorListener`, G3 at boot; `RuntimeCopy` and its test removed; the guides' install lines (Symfony leaves `--dev`); the four golden trees, a G3 unit test, the HTTP suite on both sample apps |
| 6 | the `seampact-spring-runtime` subproject with its optional Spring Data and Spring Security dependencies, the per-api lookup of `UnexpectedErrorListener`, the Gradle plugin adding the dependency, the Maven goal's G2 check, G3 at boot; `SpringBootGoldenTest`, `goldenTest`, a G3 unit test, the HTTP suite |
| 7 | not a lane PR: an entry for the publication pipelines prepared shortly before 1.0, which add the npm package and the Central artifact |

### What each ADR states when its PR lands

| ADR | Amendment |
|---|---|
| 0009 "What generated code depends on at run time" | generated server code imports its ecosystem's runtime package (this ADR) besides `hooks`; contract-specific code and per-api identity classes stay generated; client code still imports nothing from seampact. "Target resolution from the app config": the runtime package is in lockstep with its generators (G1) and checked by G2, while `hooks` keeps its own semver line and its declared range in the target metadata. "Package list for 1.0" gains `@seampact/server-runtime` and `seampact-spring-runtime` |
| 0010 | the JVM table gains `seampact-spring-runtime`; its package keeps `...springboot.runtime`, an exception to `io.github.jubasse.seampact.<module>`; `seampact/symfony` is a production package |
| 0015 "Runtime helpers" | the boundary runtime is a package, not a copy; optional helpers stay never imported. "Golden tests": the trees hold no runtime |
| 0016 NestJS | the request checks of `@seampact/codegen-core/node-server`, "copied into the generated tree", become those of `@seampact/server-runtime`, imported; "What the generated code depends on" adds `@seampact/server-runtime` (root, `/node`, `/nestjs`); the amendment of 2026-10-27 says each api's `ContractException` subclass, not its runtime copy, keeps two apis apart; the module class name; G3 in "The boot check" |
| 0017 Fastify, 0018 Express, 0019 Adonis | the shared request checks of `@seampact/codegen-core/node-server` become those of `@seampact/server-runtime`, and 0019's "copied into the generated tree" becomes imported; "What the generated code depends on" adds `@seampact/server-runtime` (root, `/node`, `/<target>`); G3 in "The boot check" |
| 0020 Hono | the `web` profile of `nodeServerRuntimeFiles()` becomes the `/web` export; "What the generated code depends on" adds the root, `/web` and `/hono`; G3 in "The boot check" |
| 0021 front targets | nothing |
| 0022 Spring Boot | "Placement" and "What the generated code depends on": `spring.runtime` is no longer generated, the code imports `io.github.jubasse.seampact.springboot.runtime` from `seampact-spring-runtime`, added by the Gradle plugin or declared for Maven; the per-api `UnexpectedErrorListener` lookup; G3 in "The boot check" |
| 0023 Laravel | "Placement": N1 (PR 4) and no `Laravel\Runtime` (PR 5); "What the generated code depends on": the code imports `Seampact\Codegen\Runtime` and `Seampact\Laravel\Runtime`, and the generator sits in production `vendor/`; the per-api `UnexpectedErrorListener` lookup; G3 in "The boot check" |
| 0024 Symfony | "Placement": no `Symfony\Runtime`; "What the generated code depends on": the code imports `Seampact\Codegen\Runtime` and `Seampact\Symfony\Runtime`, `seampact/symfony` is a production `require`, and whether its command bundle stays listed for `dev` only; the per-api operation attribute and `UnexpectedErrorListener` lookup; G3 in "The boot check" |

## Later

- A copy mode, `runtime: vendored`, only on a user's request.
- A separate PHP `-runtime` package, if the generator in production `vendor/` becomes a problem for users.

## Traceability

- Amendments: A3 (publication at 1.0), A19 (Composer mirrors), A40 (`hooks: vendored`, the model for a copy mode), A47 (no mode a consumer does not need).
- ADRs: 0009 (run-time dependencies, amended), 0010 (namespaces, artifacts), 0015 (runtime helpers and golden tests, amended), 0016 to 0024 (the targets' placement, dependencies and boot checks).
- Proof in the development phase: the review of this ADR, then the golden trees, the G2 and G3 unit tests and the HTTP suite of each delivery PR.
