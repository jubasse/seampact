# Config reference

Use this page to look up a key of `seampact.config.yaml`, with its default. Paths are relative to the config file. A key not listed here is refused with `config.schema`. For a task, start from [The config file](config-file.md).

## App config

| Key | Type | Default | Meaning |
|---|---|---|---|
| `outDir` | string | `__generated__` | The folder for all generated code. |
| `allowLocal` | boolean | `true` | `false` refuses `path` sources, for shared branches. `SEAMPACT_ALLOW_LOCAL=false` refuses them too. |
| `sources` | map | none | The contracts, by name. See [Sources](#sources). |
| `targets` | list | none | What to generate. See [Target entries](#target-entries). |
| `openapi` | `none` or map | a document per api of a server target | Where the OpenAPI documents go. See [OpenAPI](#openapi). |
| `checks` | map | see [Checks](#checks) | How `check` fails. |
| `diff` | map | see [Diff](#diff) | How `diff` fails. |

## Sources

One entry per name. Write the keys of one form.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | none | A local contract folder. It holds `workspace.yaml` or `api.yaml`. |
| `package` | string | none | A contract published as an npm package. Needs `version`. |
| `version` | string | none | The pinned version of `package`. |
| `release.url` | string | none | A contract published as a release asset. |
| `git.url`, `git.tag` | string | none | A contract in a git repository, at a tag. |
| `git.directory` | string | the repository root | The folder of the contract in the repository. |
| `maven` | string | none | A contract published as a Maven artefact, `<groupId>:<artifactId>:<version>`, with a release version (no `+`, range, `latest.*` or `-SNAPSHOT`). The Gradle and Maven plugins read it; the npm CLI refuses it with `bundle.maven-jvm-only`. Under `allowLocal: false`, an artefact from `mavenLocal()` or a `file:` repository counts as local. |
| `integrity` | string | none | The `sha256-` hash of the bundle. For `package`, `release`, `git` and `maven`. |

## Target entries

| Key | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | required | Names the entry. It is the folder under `outDir`. |
| `use` | string | required | The target package, such as `@seampact/codegen-ts`. A Python target is `pypi:` then the distribution: `pypi:seampact-fastapi`, `pypi:seampact-drf`, `pypi:seampact-ninja`. |
| `api` | string | one of `api`, `apis` | The api to generate. `<source>/<api>` when two sources hold the name. |
| `apis` | list of strings | one of `api`, `apis` | Several apis, each under its own folder. |
| `document` | string | all operations | Generate only the operations of this document of the api. |
| `out` | string | the entry's `id` | The folder under `outDir`. |
| `link` | map | none | The entries this one builds on: `validators: validators`. |
| `options` | map | none | The target's own settings. |
| `operations.include`, `operations.exclude` | list of strings | all operations | Keep or drop operations by tag or operation id. |
| `artefacts` | map of booleans | the target's own | Switch each generated part on or off. `bootCheck` also takes a map (see [Boot check](#boot-check)). `index: false` skips the api `index` module of a Node server target. |
| `artefacts.bootCheck.frameworkRoutes` | `true`, `false`, `strict` | `true` | `true` checks the app's other routes only where they reach a path of the api. `strict` checks every route of the app. `false` turns the check off. |
| `artefacts.bootCheck.hooks` | `error`, `warn`, `off` | `error` | What the server does at boot when a hook the contract needs is not registered. See [Boot check](#boot-check). |
| `allowUntested` | list of strings | none | Accept a framework major that is not tested: `nestjs@13`, `django@7`. A 0.x framework is named by its minor: `fastapi@0.163`. |
| `frameworkRoutes` | list | none | Server targets. Routes outside the contract that the boot check accepts: `path`, `reason`, optional `method`. See [Framework routes](#framework-routes). |
| `frameworkDocs` | `keep` or `off` | `keep` | Server targets. `off` drops the framework's own document. |
| `mount` | string | none | Server targets. The path prefix seampact registers the api's routes under: `/api` serves `/tasks` at `/api/tasks`. See [Mount](#mount). |

## Boot check

A server checks at boot that every hook the contract needs is registered. `artefacts.bootCheck.hooks` sets what happens when one is not.

- `error` (default): refuse to start.
- `warn`: log and start. Only the Node servers take it.
- `off`: start silently.

Spring Boot, Laravel, Symfony, FastAPI, DRF and Ninja take `error` or `off`. `warn` is refused there (`artefacts.bootCheck.hooks.warn.unsupported`; `artefact.bootCheck.hooks.warn.unsupported` on Spring Boot) and any other value is `.invalid`.

A route whose hook is missing answers 500 on every request, whatever the level. An output field right with a missing decider runs the handler first, then answers 500. A right claimed by two deciders always refuses to start, even with `bootCheck: false`.

## Framework routes

`frameworkRoutes` lists routes your framework serves outside the contract, so the boot check accepts them. Each item has `path`, `reason` and an optional `method`.

- In `path`, `*` is one segment and `**` is any number of segments. A `*` inside a segment matches any characters but `/`: `/livewire-*/**`.
- A segment holds at most two `*` and no `?`, `{` or `}`. Write a route parameter as `*`.
- A catch-all route (`/files/*rest`, `:path*`, Spring's `{*rest}`) matches only `**`.
- An empty segment, from a doubled or trailing slash, is dropped: `/a/` reads as `/a`.

`artefacts.bootCheck.frameworkRoutes` sets how far the check looks: `true` checks the app's other routes only where they reach a path of the api, `strict` checks every route, `false` turns it off.

## Mount

`mount` is the prefix seampact registers the api's routes under. It starts with `/` and holds plain ASCII: letters, digits and `-._~!$&'()+,;=@:`, so no `%`, `?` or `#`. It has no trailing `/`, no `*`, no `.` or `..` segment and no segment starting with `:`.

Do not add the same prefix in the framework (a global prefix, a route group, a `basePath`). On Spring the context path stays outside it.

## OpenAPI

`openapi` maps an api name to a path, or to a map of options.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | `openapi/<api>.yaml` | Where the document goes. |
| `extensions` | `all`, `none` or list | `all` | Which `x-seampact-` extensions it keeps. |
| `reasons` | `include` or `omit` | `include` | `omit` drops the `reason` texts of public routes and other exceptions, so a public document shows no internal rationale. |
| `inputSchemas` | `shared` or `strict` | `shared` | `strict` writes a second `<name>.input` schema that refuses unknown keys, for request bodies. |
| `servers` | list | none | OpenAPI servers: `url` and optional `description`. |

An api that declares `documents` maps each document id to a path or to these options. See [OpenAPI and docs](openapi-and-docs.md).

## Checks

| Key | Type | Default | Meaning |
|---|---|---|---|
| `checks.generated` | `error`, `warning`, `disabled` | `error` | Generated files that differ from the contract (`check.generated.drift`). |
| `checks.openapi` | `error`, `warning`, `disabled` | `error` | OpenAPI documents that differ (`check.openapi.drift`). |
| `checks.matrix` | `error`, `warning` | `warning` | A framework version seampact has not tested. |

## Warnings

| Key | Type | Default | Meaning |
|---|---|---|---|
| `warnings.ignore` | list of strings | none | Generate warnings to silence, by form, such as `paging.sortKeys`. A warning is also silenced by its full code (`paging.sortKeys.handler`). The code of a warning is printed with it. It covers the warnings a target writes, not the compatibility warnings; an entry that matches no warning is ignored. |

## Diff

| Key | Type | Default | Meaning |
|---|---|---|---|
| `diff.gate` | `clients` or `both` | `clients` | Which breaking changes fail: those that break clients, or clients and servers. The gate only applies once the api sets `compat: { policy: additive-only }`. |
| `diff.exempt` | list of `experimental`, `sunsetPassed` | both | Breaking changes that do not fail: on experimental operations, or on operations whose sunset date has passed. |

## Root config

The root config of a [monorepo](monorepo.md) takes these keys.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `apps` | list of strings | required | The app folders. Each has its own config. |
| `sources` | map | none | Sources the apps share. Same forms as above. |
| `allowLocal` | boolean | `true` | Same as in an app. |
| `openapi` | map | none | Merged documents, by name. |
| `openapi.<name>.path` | string | required | Where the merged document goes. |
| `openapi.<name>.apps` | list of strings | every app | The apps it covers. |
| `openapi.<name>.prefix` | map | none | A prefix per api for its operation ids and schema names, when they would clash. |
| `openapi.<name>.extensions`, `reasons`, `inputSchemas`, `servers` | as above | as above | The same options as an app document. |
| `checks.openapi` | `error`, `warning`, `disabled` | `error` | Drift in a merged document. |

## Per-target options

Set them under `options:` of a target entry. A key a target does not know is refused with `options.unknown`. Each heading below is the target's anchor.

### Node servers

Every Node server target takes the four shared options below. [codegen-nestjs](#codegen-nestjs), [codegen-fastify](#codegen-fastify), [codegen-express](#codegen-express), [codegen-hono](#codegen-hono), [codegen-nextjs](#codegen-nextjs) and [codegen-adonis](#codegen-adonis) link here.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | `strict` turns a reply that breaks the contract into a 500 in the api's error format. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | `true` also checks the success bodies your code writes outside the handler result. |
| `frameworkEtag` | `strip` | `strip` drops an ETag the framework adds to a reply you wrote outside the contract. `keep` leaves it. |
| `catchAll` | `true` | `true` answers unknown paths under the api's base path with the contract's 404. `false` leaves them to the app. |

### codegen-nestjs

The shared Node server options, and:

| Option | Default | What it does |
|---|---|---|
| `reply` | `handler` | `handler`: the handler wrapper writes the reply. `interceptor`: your interceptors map the result first. |

`SeampactModule.forRoot(hooks, options)` also takes these at startup. A wrong value stops the app at boot.

| `forRoot` option | What it does |
|---|---|
| `logger` | An object with `warn` and `error` functions. The default writes through NestJS's `Logger`. |
| `responses` | `strict` or `warn`. Replaces the generated mode. |
| `bodyValidation` | `true` or `false`. Needs the validators generated with the target option `bodyValidation`. |
| `unboundOperations` | `error` or `warn`. `warn` lets an app boot with a route that has no controller method, for tests. |

Guide: [NestJS](../backend/nestjs.md).

### codegen-fastify

The shared Node server options, and:

| Option | Default | What it does |
|---|---|---|
| `compression` | `{ thresholdBytes: 1024 }` | Compresses a reply body of at least that size. `off` never compresses. |

Guide: [Fastify](../backend/fastify.md).

### codegen-express

The shared Node server options only. Guide: [Express](../backend/express.md).

### codegen-hono

The shared Node server options only. Guide: [Hono](../backend/hono.md).

### codegen-nextjs

The shared Node server options, except `catchAll: false`: the api's catch-all route file is its only route. Guide: [Next.js](../backend/nextjs.md).

### codegen-adonis

The shared Node server options, and:

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses VineJS's own rules. `seampact-consistent` gives the contract's exact checks. |

Guide: [AdonisJS](../backend/adonisjs.md).

### codegen-ts

Takes no options.

### codegen-zod

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses the library's own rules. `seampact-consistent` gives the contract's exact checks. See [Validators](validators.md). |

### codegen-yup

The same `rules` option as [codegen-zod](#codegen-zod).

### codegen-class-validator

The same `rules` option as [codegen-zod](#codegen-zod).

### codegen-fetch

| Option | Default | What it does |
|---|---|---|
| `errorStyle` | `result` | `result` returns the error as a value. `throw` throws a `ContractError`. |

Guide: [React](../frontend/react.md) shows the client it feeds.

### codegen-react

| Option | Default | What it does |
|---|---|---|
| `query` | required | `tanstack`, `swr`, `rtk` or `fetch`. |
| `errors` | `throw` | `throw` or `data`: how a failed call reaches your component. |
| `invalidate` | `resource` | `resource` refreshes a resource after a write. `off` does not. |
| `staleTime` | `off` | `contract` takes the freshness from the contract. Refused with `swr` and `rtk`. |
| `infinite` | `on` | `off` skips the infinite-list helpers. |
| `keys.root` | the api id | The first segment of the query keys. Refused with `rtk`. |
| `useClientDirective` | `on` | `off` leaves out the `"use client"` line. |

With `query: fetch`, `invalidate` and `infinite` are always `off`. Guide: [React](../frontend/react.md).

### codegen-vue

The same switches as [codegen-react](#codegen-react), except `useClientDirective`. `query` is `tanstack`, `pinia-colada` or `fetch`. Guide: [Vue](../frontend/vue.md).

### codegen-angular

| Option | Default | What it does |
|---|---|---|
| `query` | required | `fetch` is the only value today. |
| `errors`, `invalidate`, `staleTime`, `infinite`, `keys.root` | as [codegen-react](#codegen-react) | The same switches. |
| `state` | none | `ngrx` or `ngrx-signals` adds state code. |

Guide: [Angular](../frontend/angular.md).

### codegen-msw

Takes no options. `validateRequests` is refused with `options.validateRequests.unsupported`. Guide: [MSW](../frontend/msw.md).

### spring-boot

| Option | Default | What it does |
|---|---|---|
| `package` | required | The Java package of the generated code. |
| `indent` | 4 | Spaces per indent, up to 8. |
| `responses`, `bodyValidation`, `frameworkEtag`, `catchAll` | as Node servers | The same four options. |
| `springSecurity` | off | `true` generates the security matchers. `{ matchers: true }` also generates a `Customizer<HttpSecurity>`. |

Guide: [Spring Boot](../backend/spring-boot.md).

### laravel

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Laravel's own value rules. `seampact-consistent` gives the contract's exact checks. |
| `responses`, `bodyValidation`, `frameworkEtag`, `catchAll` | as Node servers | The same four options. |
| `routes` | `macro` | `macro` or `file`: how the route table is registered. |
| `indent` | 4 | Spaces per indent, up to 8. |

Guide: [Laravel](../backend/laravel.md).

### symfony

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Symfony's own constraints. `seampact-consistent` gives the contract's exact checks. |
| `responses`, `bodyValidation`, `frameworkEtag`, `catchAll` | as Node servers | The same four options. |
| `indent` | 4 | Spaces per indent, up to 8. |

Guide: [Symfony](../backend/symfony.md).

### seampact-fastapi

Python targets are named `pypi:<distribution>` in `use` (`pypi:seampact-fastapi`, `pypi:seampact-drf`, `pypi:seampact-ninja`).

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses the framework's value rules. `seampact-consistent` gives the contract's exact checks. |
| `responses`, `frameworkEtag`, `catchAll` | as Node servers | The same options. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |

`artefacts` takes `routeHelpers`, `bootCheck` and `nativeDocs`. The naming options, `layout`, `handlers: perOperation` and an `indent` other than 4 are refused by name. Guide: [FastAPI](../backend/fastapi.md).

### seampact-drf

The options of [seampact-fastapi](#seampact-fastapi), except `bodyValidation`, which DRF refuses at boot until it is served. `artefacts` takes `routeHelpers` and `bootCheck`. Guide: [Django REST Framework](../backend/drf.md).

### seampact-ninja

The options of [seampact-fastapi](#seampact-fastapi), except `bodyValidation`, plus `views` (`sync` default, or `async`). `artefacts` takes `routeHelpers`, `bootCheck` and `nativeDocs`. Guide: [Django Ninja](../backend/ninja.md).

Next: [Troubleshooting config errors](../troubleshooting/config.md).
