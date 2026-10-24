# Package map

You install the core, then only the generators your project uses. Installing the CLI pulls no code generator.

Already running end to end today: the core, `codegen-ts`, `codegen-zod`, `codegen-yup`, `codegen-class-validator`, `codegen-fetch`, `codegen-react` (TanStack Query), `codegen-nestjs`, `codegen-express`, `codegen-fastify`, `codegen-adonis` and `codegen-hono`, with the signed-webhook and in-memory idempotency helpers. Every other package below is planned for 1.0 unless a row says it comes later.

## Core (npm)

| Package | What it does |
|---|---|
| `@seampact/cli` | the `seampact` command: `compile`, `check`, `lint`, `diff`, `generate`, `bundle` (packs a contract to publish), `explain` (prints one operation whole with where each part comes from) and `init` (starts a contract project) |
| `@seampact/compiler` | reads the YAML, reports errors with file, line and column, and produces the IR |
| `@seampact/spec` | the JSON Schemas of the YAML files, one per file and fragment kind for your editor, and of the IR, with their TypeScript types |
| `@seampact/openapi` | writes the OpenAPI 3.1 documents your configs ask for (one per api or declared document, or one merged across a monorepo's apps), with what OpenAPI cannot say as published `x-seampact-*` extensions |
| `@seampact/lint` | lint rules over the IR, and the API to write your own |
| `@seampact/diff` | classifies changes between two versions as additive or breaking, per direction |
| `@seampact/codegen-core` | the API code generators are written against |

## Code generators for TypeScript (npm)

| You want | Install |
|---|---|
| types only | `@seampact/codegen-ts` |
| validators | `@seampact/codegen-zod`, `@seampact/codegen-yup` or `@seampact/codegen-class-validator` |
| a typed `fetch` client | `@seampact/codegen-fetch` |
| a server boundary | `@seampact/codegen-nestjs`, `@seampact/codegen-fastify`, `@seampact/codegen-express` or `@seampact/codegen-adonis`, plus `@seampact/hooks` unless the target vendors its types |
| React hooks (TanStack Query; SWR and RTK Query planned) | `@seampact/codegen-react` |
| an Angular or Vue client (planned) | `@seampact/codegen-angular` or `@seampact/codegen-vue` |
| a Web-standard server boundary (Hono 4) | `@seampact/codegen-hono` |
| mock handlers for tests and local work (planned) | `@seampact/codegen-msw` |

A server generator does not install a validator generator. You choose one and link the two in your app's `seampact.config.yaml`, where you also turn each generated artefact on or off. The CLI checks the combination against a published compatibility matrix and, when it does not work, names the ones that do.

`codegen-class-validator` works on `codegen-nestjs` only, and the app must load `reflect-metadata` once at startup (`import "reflect-metadata"` in its entry file) for the decorators to work.

Each app of a repository (frontend, backend, service) has its own `seampact.config.yaml`; a monorepo can add a root one that lists the apps and shares contract sources. An app that only needs the OpenAPI document installs no generator at all, and an app that wants no seampact document says so.

## Java and PHP

These run with no Node.js installed. The standalone compiler binary (built for linux x64 and arm64, macOS x64 and arm64, Windows x64; release downloads next) runs `compile`, `lint` (core rules), `diff`, `explain` and `bundle`. `generate` and `check` run through the npm CLI or the Gradle, Maven or Composer plugin. The Gradle and Maven plugins read `seampact.config.yaml` or the same keys in their own DSL.

| Framework | Install |
|---|---|
| Spring Boot 4 | the Gradle plugin `io.github.jubasse.seampact` or the Maven plugin `io.github.jubasse:seampact-maven-plugin`, and `io.github.jubasse:seampact-hooks` unless the target vendors its types |
| Laravel | `seampact/laravel` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| Symfony | `seampact/symfony` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| API Platform | `seampact/api-platform` as a development dependency, and `seampact/hooks` unless the target vendors its types |


## Optional packages

| Package | Use it when |
|---|---|
| `@seampact/pack-crud-rights` | you want a `<resource>.<op>` right on every route the `ops` shorthand generates, `batch` included, without declaring each one |
| `@seampact/pack-api-platform` | your API Platform api serves JSON-LD items, Hydra pages and Hydra errors |
| `@seampact/pack-laravel` | your api serves Laravel API Resources and paginators |
| `@seampact/pack-spring` | your api serves Spring Data `Page` bodies |
| `@seampact/pack-jsonapi` | your api speaks JSON:API |
| `@seampact/pack-hal` | your api serves HAL |
| `@seampact/nestjs-casl` | your NestJS app decides rights with CASL |
| `seampact/laravel-spatie` | your Laravel app decides rights with spatie/laravel-permission |
| `@seampact/signed-webhooks`, and its Java and PHP equivalents | you receive Stripe-style or GitHub-style signed webhooks and want the signature checked for you; other senders (Standard Webhooks, Slack) are verified by your own hook with their own library |
| `@seampact/http-suite` | you write your own server target and want to prove it against the shared HTTP suite |

