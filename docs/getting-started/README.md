# Getting started

You write a contract in YAML. seampact generates the types, the validators, the server routes and the clients. You write the handlers. This guide builds a notes API on NestJS and calls it from React.

You need Node.js 24 or later and npm. Another server: [Your first API](your-first-api.md) links the guide of each framework.

1. [Install](01-install.md) seampact with npm and start a project.
2. [Your first API](your-first-api.md): write the contract, generate, write the handlers and run the app.
3. [Call it from React](call-it-from-react.md): generate a typed client and hooks.
4. [Check it in CI](../features/check-in-ci.md): fail the build when the generated files drift. [Diff a change](../features/diff.md) shows what an edit breaks for clients.

Also:

- [Install in other ecosystems](install-other-ecosystems.md): Maven Central, Packagist, PyPI, the compiler binary and a checkout.
- [Add seampact to an existing app](04-existing-project.md): move routes one at a time.
- [Project layout](05-project-layout.md): what each file is.
- [Work with an AI agent](06-ai-agents.md): guard rails for an agent.
- [What is seampact](../concepts/what-is-seampact.md) and the [glossary](../concepts/glossary.md).
- Every key of `seampact.config.yaml`: [the config reference](../configuration/reference.md).
- Something fails: [troubleshooting](../troubleshooting/README.md).

Next: [Install](01-install.md)
