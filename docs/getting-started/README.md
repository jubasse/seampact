# Getting started: a notes API on NestJS

You write a contract in YAML. seampact generates the types, the zod validators and the NestJS routes. You write the handlers. At the end, a notes API runs on port 3000.

You need Node.js 24 or later, pnpm, and a checkout of this repository. Nothing is published to npm yet, so step 1 installs seampact from your checkout.

1. [Install](1-install.md)
2. [Write the contract](2-contract.md)
3. [Generate the code](3-generate.md)
4. Write the handlers: [NestJS](4-handlers-nestjs.md) or [Express](4-handlers-express.md)
5. [Run it](5-run.md)
6. [Check a change](6-check-a-change.md)

Every key of `seampact.config.yaml`: [configuration](configuration.md).

Something fails? See [troubleshooting](troubleshooting.md).
