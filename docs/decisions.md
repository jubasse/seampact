# Product decisions

The ADRs and the conformance checklist cite product decisions by id, from A1 to A44. This log states each decision as it stands now. When a later decision refines an earlier one, the entry gives the final form and names the decision that refined it. The ids are stable: a decision is never renumbered.

A36 is the governing principle: where an older decision reads as imposing a convention, A36 prevails.

The ADRs also cite FR-n and SCN-n ids. They refer to the requirement and scenario catalogue of FEAT-001, the project's first feature, which is maintained outside the repository for now.

## Decisions

<a id="a1"></a>
**A1.** The project is named seampact, with the npm scope `@seampact`, the public GitHub repository `jubasse/seampact`, the MIT license and one monorepo.

<a id="a2"></a>
**A2.** Modularity is a hard condition: installing the tool gives only the YAML and IR core. Each code generation target, and each target's runtime helpers, is a separate package the consumer adds explicitly, and the CLI never depends on or bundles a target.

<a id="a3"></a>
**A3.** Nothing is published to npm until the project is complete, functional and tested. There are no `0.x` pre-releases; the first publication follows the end-to-end proof of A12 and a full test pass.

<a id="a4"></a>
**A4.** Development process choice: each feature is framed (requirements, scenarios, architecture) before it is built, and the framing work is kept outside the repository. No effect on the product.

<a id="a5"></a>
**A5.** Inbound signed webhooks are in 1.0, as a signed identity kind. Besides signature schemes, a neutral form hands the raw body and the declared headers to the authenticate hook, so any library can verify (refined by A40).

<a id="a6"></a>
**A6.** 1.0 includes every planned target, the JVM and PHP targets included, and the end-to-end proof in test consumer projects (refined by A12, A15).

<a id="a7"></a>
**A7.** Generators outside the TypeScript ecosystem are native to their ecosystem (Gradle and Maven plugins for Java, Composer packages for PHP; later NuGet for .NET and pip for Python). They read the IR, and their users install them with the ecosystem's own tool.

<a id="a8"></a>
**A8.** The IR is under semver from 1.0 (before 1.0 it may change, with release notes): an additive change keeps `irVersion`, a removal or a change of meaning bumps `irVersion` and the major version, and each target declares the `irVersion` range it reads.

<a id="a9"></a>
**A9.** A native plugin gets the IR from the contract bundle (precompiled and hash-checked) or, for a local YAML source, from a standalone compiler binary pinned by hash. The consumer never needs Node.js.

<a id="a10"></a>
**A10.** .NET (NuGet) and Python (FastAPI, pip) targets illustrate the native principle in the design and are a v2 objective.

<a id="a11"></a>
**A11.** No performance threshold gates CI in 1.0; thresholds may come in v2 or v3.

<a id="a12"></a>
**A12.** A first production adopter migrates only after 1.0. Before 1.0, the conformance checklist is proven by the monorepo's fixtures and by standalone test consumer projects, which live outside the repository; one of them carries the end-to-end proof (refined by A16).

<a id="a13"></a>
**A13.** The spring-boot target generates Java that compiles and is tested on Java 21 and 25.

<a id="a14"></a>
**A14.** The TypeScript validator targets in 1.0 are zod and yup (both through Standard Schema) and class-validator with class-transformer (decorated DTO classes). Any other validator library is a new target.

<a id="a15"></a>
**A15.** 1.0 also includes adonis (npm, VineJS) and the native PHP targets laravel, symfony and api-platform (Composer packages written in PHP, no Node.js on the consumer side). Which OpenAPI documents api-platform emits is the user's choice (refined by A43).

<a id="a16"></a>
**A16.** Refines A12: research into existing production APIs may inform the concepts the checklist names, but no outside code or document enters the repository, and the first production adopter still migrates only after 1.0.

<a id="a17"></a>
**A17.** Full parity: every 1.0 server target generates the whole server boundary, proven by one shared black-box HTTP conformance suite and by one test consumer project per target, which is that target's named consumer.

<a id="a18"></a>
**A18.** The rights model is generic: it covers roles, fine-grained permissions, multi-tenant setups and full authorization libraries (Laravel Policies, Symfony Voters, Spring Security, CASL), whatever the framework. It has its own ADR, written after research (ADR 0012; refined by A20, A25).

<a id="a19"></a>
**A19.** PHP packages live in the monorepo. CI pushes each one to a read-only mirror repository for Composer; the mirrors are created only before publication.

<a id="a20"></a>
**A20.** Rights stay flexible: an application may bypass the native framework mapping and plug in its own implementation; the core never imposes right names or conventions (naming and derived rights come from opt-in convention packs the user can write); custom metadata on a right reaches the generated boundary; and each target lets the app override how a right maps to its hook.

<a id="a21"></a>
**A21.** A restricted field sent on input without the right is either rejected with 403 and the field's pointer (the default) or stripped. The choice is set per api in conventions and can be overridden per field.

<a id="a22"></a>
**A22.** Changes-since paging is in 1.0, with cursors and pages.

<a id="a23"></a>
**A23.** Tenancy is open: a route may run in zero, one or several nested scopes. Each scope id comes from a declared source (path, query, header, host or subdomain, principal field) or from a resolver interface the app implements. No single resolution scheme is imposed.

<a id="a24"></a>
**A24.** 1.0 ships the generic rights decider, the opt-in derived CRUD rights pack, and the CASL (NestJS) and spatie (Laravel) adapters, each with its own conformance tests. The adapters are optional packages (A25).

<a id="a25"></a>
**A25.** Authentication, rights, roles and tenancy are unopinionated, even at the cost of less generated code: the contract declares what a route requires, and the generated boundary is one neutral, typed hook per concern (authenticate, decide, resolve scope) plus registration and a boot check. Any library or hand-written code plugs in behind it, and library integrations are optional adapter packages that no target requires.

<a id="a26"></a>
**A26.** Distribution is complete in 1.0: bundles ship as an npm package, a release asset and a git tag, and the standalone compiler binary ships for Linux x64 and arm64, macOS x64 and arm64 and Windows x64, each with a CI smoke test.

<a id="a27"></a>
**A27.** Namespaces: Maven groupId `io.github.jubasse`, Gradle plugin id `io.github.jubasse.seampact`, Composer vendor `seampact` (`seampact/laravel`, `seampact/symfony`, `seampact/api-platform`) and npm scope `@seampact`. They are claimed only at publication.

<a id="a28"></a>
**A28.** seampact adapts to API Platform rather than disabling it: API Platform's native formats (JSON-LD, Hydra paging, Hydra or problem+json errors) come through an opt-in api-platform convention pack (refined by A30, A32, A43).

<a id="a29"></a>
**A29.** Development tooling choice; no effect on the product.

<a id="a30"></a>
**A30.** seampact is a contract system, not a framework: the core default wire format is the bare payload with RFC 9457 problem+json errors, and every other format (JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring Page and ProblemDetail, house envelopes) is a convention pack the contract opts into. Each target maps the declared format onto the framework's own mechanism and plugs into its popular libraries through neutral hooks and optional adapters.

<a id="a31"></a>
**A31.** Paging imposes no convention and the core ships no default page shape: a contract declares its paging style (cursor, page or offset, infinite scroll, changes-since, or its own) as semantic roles, each mapped to a location and a name of its choosing, and format packs only provide presets of that mapping. A paged list with neither a mapping nor a pack is a compile error that names both fixes.

<a id="a32"></a>
**A32.** The first-party format packs in 1.0 are api-platform (JSON-LD, Hydra), laravel (API Resources and paginators), spring (Page, ProblemDetail), JSON:API and HAL, and RFC 9457 problem+json stays the error default without a pack. `@seampact/http-suite` is published with 1.0, for third-party target authors.

<a id="a33"></a>
**A33.** On `optionalAuth`, a refused credential is treated as anonymous by default (refined by A40); a versioned DELETE carries its version in the query or in `If-Match`, never in a body; and a `/v{n}` path prefix is the default, which an api may opt out of (header, media type, fixed third-party path). Generated code keeps the authored property order, with a defined include merge order.

<a id="a34"></a>
**A34.** Derived errors have default codes in the core (`api.schema_invalid`, `api.unauthenticated`, `api.forbidden`, ...), each renamable in the contract or by a pack and rendered as RFC 9457 problem+json unless a format pack says otherwise, so a contract with no pack compiles. Idempotency keys and CSRF are opt-in: `conventions.idempotency` makes every write carry a key unless exempt with a reason, and a cookie scheme that declares `csrf` enables CSRF on its writes.

<a id="a35"></a>
**A35.** Custom error codes can be declared at every level of the tree (base and api, resource, single, path scope, route): an error applies to every operation below its node, children add or narrow, and the IR records the node each error came from. Declaring the same code twice with different definitions is a compile error, re-attaching an inherited code is allowed, and derived default codes (A34) can be renamed at any of these levels.

<a id="a36"></a>
**A36.** Governing principle: seampact imposes nothing. On every point (auth, rights, roles, tenancy, formats, envelopes, paging, errors, headers, naming, versioning, idempotency, validation library, client library, file layout, code style) the core offers neutral, typed boundaries, renamable defaults where a default is needed to compile, and opt-in packs and adapters; what a contract must give is explicitness (every route states its access, every exception its reason), never a way of implementing it.

<a id="a37"></a>
**A37.** Each app has its own `seampact.config.yaml`, which can stand alone or be listed by a monorepo's root config that shares contract sources; it selects the targets combined for that app and, per target, which artefacts are generated, and generating only the OpenAPI document is a first-class setup. A published compatibility matrix lets the CLI refuse an incompatible combination with a diagnostic that names the working alternatives.

<a id="a38"></a>
**A38.** YAML is the only authoring medium, and editor support comes through editor schemas, `seampact explain` and `pick`/`omit` derived schemas. A one-shot importer from an existing OpenAPI document is planned for v3.

<a id="a39"></a>
**A39.** Bodies and statuses beyond JSON and 2xx are in 1.0 and typed in the contract: multipart uploads (typed fields and files), binary downloads, `application/x-www-form-urlencoded` bodies and 3xx redirects. Every target renders them with its native mechanism.

<a id="a40"></a>
**A40.** Six refinements under A36: `optionalAuth` takes `onRefused: anonymous | reject`, default `anonymous` (refines A33); a reason is required only for safety exceptions (access, CSRF, idempotency, unknown keys); signed webhooks add a neutral `verify: application` form (refines A5); the `x-seampact-*` extensions of the emitted OpenAPI document are switchable, and the conformance item that requires every IR member holds only with all of them on; the hooks package stays small and dependency-free, or an app vendors its types; and a contract may add error natures, each mapped onto one of the three built-in natures that drive retries.

<a id="a41"></a>
**A41.** No target ever generates the real framework controller: code generation emits annotations, attributes, decorators, validation schemas, types and interfaces, and generated utilities (guards, interceptors, argument resolvers, form requests, attributes) place every step of the check order around the controller the developer writes, which implements the generated interface. Generated code goes to one directory, `__generated__` by default, configurable per app.

<a id="a42"></a>
**A42.** On the JVM, the seampact config is written either in `seampact.config.yaml` or in the Gradle or Maven plugin DSL, with the same keys and schema, and an app with both is an error. Spring may get opt-in generated Spring Security request matchers for public and `optionalAuth` routes, A21's `reject` stays the default (API Platform enforces it before denormalisation), and `accessHooks: false` with the framework's native access control is an official setup in which seampact exports each route's access metadata.

<a id="a43"></a>
**A43.** Which OpenAPI documents exist is the user's choice, for every target alike: per app, seampact's document (the default), the framework's native document completed by code generation (`nativeDocs`), both, or none, with native generation left as the framework has it unless `nativeDocs` is on. In a monorepo, the root config may also emit one merged document across the apps.

<a id="a44"></a>
**A44.** Development process: git flow, with `feat/` branches squash-merged into develop, `release/` branches merged into main and back into develop, and `hotfix/` branches from main merged into main and develop. develop is the default branch until 1.0 and main from then on; both are protected (required `ci` check, no force push, no deletion) and receive no direct commits.
