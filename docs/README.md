# Documentation

## Getting started

- [Getting started](getting-started/README.md): a notes API on NestJS, step by step.
- [Install](getting-started/01-install.md): install seampact from your checkout.
- [Write the contract](getting-started/02-first-contract.md): a notes contract.
- [Generate the code and run it](getting-started/03-generate-and-run.md): generate, pick a server, run.
- [Add seampact to an existing NestJS app](getting-started/04-existing-project.md): move routes one at a time.
- [Project layout](getting-started/05-project-layout.md): what each file is.
- [Work with an AI agent](getting-started/06-ai-agents.md): guard rails for an agent.

## Contract

- [Contract](contract/README.md): how to write the contract, one task per page.
- [The shape of a contract](contract/01-basics.md): api, surfaces, collections and routes.
- [Types and references](contract/02-types-and-refs.md): schemas, enums, split files.
- [Errors](contract/03-errors.md): declare, attach and rename codes.
- [Access](contract/04-access.md): public routes, identities and rights.
- [Lists](contract/05-lists.md): paging styles and sorting.
- [Versioning and change](contract/06-versioning.md): version, maturity, deprecation.
- [Advanced](contract/07-advanced.md): uploads, lost updates, cache.

## Backend

- [NestJS](backend/nestjs.md)
- [Express](backend/express.md)
- [Fastify](backend/fastify.md)
- [AdonisJS](backend/adonisjs.md)
- [Hono](backend/hono.md)
- [Spring Boot](backend/spring-boot.md): the Gradle or Maven plugin, controllers and hooks.
- [Laravel](backend/laravel.md): Composer, controllers, hooks and Laravel's own auth.
- [Symfony](backend/symfony.md): the Composer package, bundle, controllers, hooks and SecurityBundle.

## Frontend

- [React](frontend/react.md): TanStack Query, SWR or RTK Query hooks over the fetch client.
- [Vue](frontend/vue.md): TanStack Query, Pinia Colada or plain `fetch` composables.
- [Angular](frontend/angular.md): an api service over `HttpClient` with signal readers, and NgRx actions and effects or NgRx Signals store features as an option.
- [MSW mocks](frontend/msw.md): typed mock handlers to test the client with no backend.
- [Point the client at your backend](frontend/backend-url.md): the backend URL per environment, Docker included.
- [Expo and React Native](frontend/mobile.md): the client and the React hooks on a phone.

## Configuration

- [The config file](configuration/config-file.md): location, output folder, sources.
- [Targets and links](configuration/targets-and-links.md): add a target, which generators combine.
- [Validators](configuration/validators.md): switch the validator library.
- [OpenAPI and docs](configuration/openapi-and-docs.md): OpenAPI documents and Swagger.
- [Checks](configuration/checks.md): what `check` fails on.
- [Monorepo](configuration/monorepo.md): one config for several apps.
- [Config reference](configuration/reference.md): every key, its type and default.

## Features

- [Diff](features/diff.md): see what a contract edit breaks.
- [Check in CI](features/check-in-ci.md): fail the build on drift.
- [Sharing contracts](features/sharing-contracts.md): publish a contract to other repositories.
- [Lint](features/lint.md): run lint, change a rule level, allow a case, write a rule.
- [Convention packs](features/convention-packs.md): add a pack, what each brings.
- [Editor support](features/editor-support.md): checks and completion in your editor.

## Concepts

- [What you get](concepts/what-you-get.md): what seampact generates, leaves to you and does not do.
- [Packages](concepts/packages.md): the package map.

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
- [Boot errors](troubleshooting/boot.md): the server refuses to start.
- [CLI errors](troubleshooting/cli.md): `cli.*`, `lint.*`, `diff.*`, `explain.*`, `binary.*`.

## Project

- [Roadmap](roadmap.md)
- [Design decisions](design-decisions.md)

## Reference

- [Grammar](grammar/): every contract key, section by section ([full example](grammar/example.md)).
- [IR](ir/): the compiled form of a contract.
- [ADRs](adr/): design records.
