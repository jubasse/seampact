# Getting started: a notes API on NestJS

You write a contract in YAML. seampact generates the types, the zod validators and the NestJS routes. You write the handlers. At the end, a notes API runs on port 3000.

You need Node.js 24 or later, pnpm, and a checkout of this repository. Nothing is published to npm yet, so [Install](01-install.md) installs seampact from your checkout.

1. [Install](01-install.md)
2. [Write the contract](02-first-contract.md)
3. [Generate the code and run it](03-generate-and-run.md), with the handlers for [NestJS](../backend/nestjs.md), [Express](../backend/express.md), [Fastify](../backend/fastify.md), [AdonisJS](../backend/adonisjs.md) or [Hono](../backend/hono.md)
4. [Diff a change](../features/diff.md) and [check it in CI](../features/check-in-ci.md)

Also:

- [Add seampact to an existing NestJS app](04-existing-project.md)
- [Project layout](05-project-layout.md)
- [Work with an AI agent](06-ai-agents.md)
- Every key of `seampact.config.yaml`: [the config file](../configuration/config-file.md)
- Something fails: [troubleshooting](../troubleshooting/README.md)
