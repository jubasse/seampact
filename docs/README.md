# Documentation

## Getting started

- [Getting started](getting-started/README.md): a notes API on NestJS, step by step.
- [Install](getting-started/install.md): install seampact from your checkout.
- [Write the contract](getting-started/first-contract.md): a notes contract.
- [Generate the code and run it](getting-started/generate-and-run.md): generate, pick a server, run.
- [Add seampact to an existing NestJS app](getting-started/existing-project.md): move routes one at a time.
- [Project layout](getting-started/project-layout.md): what each file is.
- [Work with an AI agent](getting-started/ai-agents.md): guard rails for an agent.

## Contract

- [Contract](contract/README.md): how to write the contract, one task per page.
- [The shape of a contract](contract/basics.md): api, surfaces, collections and routes.
- [Types and references](contract/types-and-refs.md): schemas, enums, split files.
- [Errors](contract/errors.md): declare, attach and rename codes.
- [Access](contract/access.md): public routes, identities and rights.
- [Lists](contract/lists.md): paging styles and sorting.
- [Versioning and change](contract/versioning.md): version, maturity, deprecation.
- [Advanced](contract/advanced.md): uploads, lost updates, cache.

## Backend

- [NestJS](backend/nestjs.md)
- [Express](backend/express.md)
- [Fastify](backend/fastify.md)
- [AdonisJS](backend/adonisjs.md)
- [Hono](backend/hono.md)

## Frontend

- [Mobile and Capacitor](frontend/mobile.md): what mobile apps use today.

## Configuration

- [The config file](configuration/config-file.md): location, output folder, sources.
- [Targets and links](configuration/targets-and-links.md): add a target, which generators combine.
- [Validators](configuration/validators.md): switch the validator library.
- [OpenAPI and docs](configuration/openapi-and-docs.md): OpenAPI documents and Swagger.
- [Checks](configuration/checks.md): what `check` fails on.
- [Monorepo](configuration/monorepo.md): one config for several apps.

## Features

- [Diff](features/diff.md): see what a contract edit breaks.
- [Check in CI](features/check-in-ci.md): fail the build on drift.
- [Sharing contracts](features/sharing-contracts.md): publish a contract to other repositories.

## Concepts

- [What you get](concepts/what-you-get.md): what seampact generates, leaves to you and does not do.
- [Packages](concepts/packages.md): the package map.

## Troubleshooting

- [Troubleshooting](troubleshooting/README.md): errors and fixes.

## Project

- [Roadmap](roadmap.md)
- [Design decisions](design-decisions.md)

## Reference

- [Grammar](grammar/): every contract key, section by section ([full example](grammar/example.md)).
- [IR](ir/): the compiled form of a contract.
- [ADRs](adr/): design records.
