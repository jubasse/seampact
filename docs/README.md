# Documentation

seampact turns one YAML contract into the server code, the typed clients and the OpenAPI document of your HTTP API. You write the handlers. seampact writes the checks around them, and `seampact check` fails in CI when the generated files drift from the contract.

The same pages, with search, are on the [documentation site](https://jubasse.github.io/seampact/). New here? Read [What is seampact](concepts/what-is-seampact.md), then [Install](getting-started/01-install.md).

## Introduction

- [What is seampact](concepts/what-is-seampact.md): what it does, in two paragraphs.
- [What you get and what you write](concepts/what-you-get.md): what seampact generates, what is yours and what it does not do.
- [Supported versions](supported-versions.md): every framework and its versions.
- [Glossary](concepts/glossary.md): the words these docs use, one meaning each.
- [Packages](concepts/packages.md): the package map.

## Getting started

- [Install](getting-started/01-install.md): install seampact from npm and start a project.
- [Your first API](getting-started/your-first-api.md): a notes API on the server of your choice, step by step.
- [Call it from React](getting-started/call-it-from-react.md): a typed client and hooks.
- [Runnable example](../examples/nestjs-react/README.md): a NestJS server and a React client from one contract, kept green by CI.
- [Check it in CI](features/check-in-ci.md): fail the build on drift.
- [Add to an existing app](getting-started/04-existing-project.md): move routes one at a time.
- [Project layout](getting-started/05-project-layout.md): what each file is.
- [Work with an AI agent](getting-started/06-ai-agents.md): guard rails for an agent.
- [Install in other ecosystems](getting-started/install-other-ecosystems.md): Maven Central, Packagist, PyPI, the binary and a checkout.

## Writing the contract

- [Contract](contract/README.md): how to write the contract, one task per page.
- [The shape of a contract](contract/01-basics.md): api, surfaces, collections and routes.
- [Types and references](contract/02-types-and-refs.md): schemas, enums, split files.
- [Errors](contract/03-errors.md): declare, attach and rename codes.
- [Access](contract/04-access.md): public routes, identities and rights.
- [Lists](contract/05-lists.md): paging styles and sorting.
- [Versioning and change](contract/06-versioning.md): version, maturity, deprecation.
- [Advanced](contract/07-advanced.md): uploads, lost updates, cache.

## Types and validation

- [Types and validation](types-and-validation/README.md): what each stack gets from your schemas, the 400 error body and the rules modes.
- [TypeScript types](types-and-validation/typescript-types.md): one type per schema, request, reply and error.
- [zod](types-and-validation/zod.md): zod schemas for the Node servers.
- [yup](types-and-validation/yup.md): yup schemas for the Node servers.
- [class-validator](types-and-validation/class-validator.md): decorated DTO classes for NestJS.
- [Ajv](types-and-validation/ajv.md): Fastify's own validators, when you link none.
- [VineJS](types-and-validation/vinejs.md): AdonisJS's own validators, when you link none.
- [Java records](types-and-validation/java-records.md): records and a generated structural validator on Spring Boot.
- [Laravel rules](types-and-validation/laravel-rules.md): `FormRequest` rules on Laravel.
- [Symfony constraints](types-and-validation/symfony-constraints.md): classes and constraints on Symfony.
- [Pydantic](types-and-validation/pydantic.md): Pydantic 2 models on FastAPI and Django Ninja.
- [DRF serializers](types-and-validation/drf-serializers.md): dataclasses and serializers on Django REST Framework.

## Server guides

- [NestJS](backend/nestjs.md): Node, decorators and a module.
- [Express](backend/express.md): Node, Express 4 and 5.
- [Fastify](backend/fastify.md): Node, Fastify 5 with route hooks.
- [AdonisJS](backend/adonisjs.md): Node, AdonisJS 7 and 6.
- [Hono](backend/hono.md): Hono 4 on any Web-standard runtime.
- [Access hooks on Node](backend/node-hooks.md): authenticate, decide and resolve scope on the five Node servers.
- [Spring Boot](backend/spring-boot.md): Java, the Gradle or Maven plugin, controllers and hooks.
- [Laravel](backend/laravel.md): PHP, Composer, controllers, hooks and Laravel's own auth.
- [Symfony](backend/symfony.md): PHP, the Composer package, bundle, controllers, hooks and SecurityBundle.
- [FastAPI](backend/fastapi.md): Python, the wheels, `bind_<api>()`, handlers, hooks and FastAPI's own docs.
- [Django REST Framework](backend/drf.md): Python, the wheels, settings, URLconf, handlers, hooks and DRF's own auth.
- [Django Ninja](backend/ninja.md): Python, the wheels, `bind_<api>()`, handlers, hooks, Ninja's own auth and docs.

## Client guides

- [Fetch client](frontend/fetch-client.md): the typed `fetch` client every other client builds on.
- [Axios client](frontend/axios-client.md): the same client, sent through your own axios instance.
- [React](frontend/react.md): TanStack Query, SWR or RTK Query hooks over the fetch client.
- [Vue](frontend/vue.md): TanStack Query, Pinia Colada or plain `fetch` composables.
- [Angular](frontend/angular.md): an `HttpClient` service with signals, NgRx optional.
- [MSW mocks](frontend/msw.md): typed mock handlers to test the client with no backend.
- [Point the client at your backend](frontend/backend-url.md): the backend URL per environment, Docker included.
- [Expo and React Native](frontend/mobile.md): the client and the React hooks on a phone.

## Workflow

- [Commands per stack](features/commands-per-stack.md): how to run each command on Node, Gradle, Maven, PHP and Python.
- [Diff](features/diff.md): see what a contract edit breaks.
- [Check in CI](features/check-in-ci.md): fail the build on drift.
- [Sharing contracts](features/sharing-contracts.md): publish a contract to other repositories.
- [Lint](features/lint.md): run lint, change a rule level, allow a case.
- [Convention packs](features/convention-packs.md): add a pack, what each brings.
- [Editor support](features/editor-support.md): checks and completion in your editor.

## Configuration

- [The config file](configuration/config-file.md): location, output folder, sources.
- [Targets and links](configuration/targets-and-links.md): add a target, which generators combine.
- [Switch the validator](configuration/validators.md): change the validator library, or the rules mode.
- [OpenAPI and docs](configuration/openapi-and-docs.md): OpenAPI documents and Swagger.
- [Checks](configuration/checks.md): what `check` fails on; the levels are set in [Check in CI](features/check-in-ci.md#set-the-levels).
- [Monorepo](configuration/monorepo.md): one config for several apps.
- [Config reference](configuration/reference.md): every key, its type and default.

## Troubleshooting

- [Troubleshooting](troubleshooting/README.md): find an error by its code.
- [Config errors](troubleshooting/config.md): `config.*`.
- [Monorepo and OpenAPI errors](troubleshooting/config-root.md): `config.root.*`, `config.apps.*`, `config.openapi.*`.
- [Link errors](troubleshooting/link.md): `link.*`.
- [Bundle errors](troubleshooting/bundle.md): `bundle.*`.
- [Target option errors](troubleshooting/generate.md): `options.*`, `paging.*`.
- [Check errors](troubleshooting/check.md): `check.*`, `writer.*`.
- [Contract file errors](troubleshooting/load.md): `seampact/load/*`.
- [Contract key errors](troubleshooting/validate.md): `seampact/validate/*`.
- [Contract content errors](troubleshooting/tree.md): `seampact/tree/*`.
- [Access and error code errors](troubleshooting/access-and-errors.md): `seampact/access/*`, `seampact/derive/*`.
- [Signed webhook errors](troubleshooting/signed-webhooks.md): `signature.*`.
- [Boot errors](troubleshooting/boot.md): the server refuses to start.
- [CLI errors](troubleshooting/cli.md): `cli.*`, `init.*`, `compile.*`, `ir.*`, `lint.*`, `diff.*`, `explain.*`, `binary.*`, `bundle.source.*`.

## Reference

- [Grammar](grammar/): every contract key, section by section ([full example](grammar/example.md)).
- [Supported versions](supported-versions.md): which framework versions seampact supports, and when it drops one.

## Release notes

- [Release notes](release-notes/README.md): what each release ships and its known limits.
- [1.0.1](release-notes/1.0.1.md): server fixes, clearer errors, docs and agent skills.
- [1.0.0](release-notes/1.0.0.md): the first release.

## Design

For contributors. Users do not need these pages.

- [IR](ir/): the compiled form of a contract.
- [ADRs](adr/): design records.
- [Product decisions](decisions.md): the log of decisions, A1 to A48.
- [Design decisions](design-decisions.md)
- [Roadmap](roadmap.md)
