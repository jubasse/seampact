# Work with an AI agent

The contract and the config are the source of truth. Give the agent two things: four skills it reads when it needs them, and a short block of rules in `AGENTS.md`. Then seampact checks its work.

## Install the skills

```sh
npx skills add jubasse/seampact
```

This uses the standard [skills CLI](https://github.com/vercel-labs/skills). It works for every stack and for any agent the CLI supports: it asks which agents to install for, and which skills.

- Add `-g` to install for your user instead of the project.
- Run `npx skills update` after you upgrade seampact.
- `npx skills add jubasse/seampact --list` shows the four skills without installing them.

Each skill has a `references/` folder. You only need the file of your own stack. Delete the others if you like.

## Add the block

Copy the block below into `AGENTS.md`. Replace `npx seampact` with the line for your stack: see [commands per stack](../features/commands-per-stack.md). The compiler binary has no `generate` or `check`; use the build command of your stack there.

An agent that reads the web can start from [llms.txt](https://jubasse.github.io/seampact/llms.txt): it lists the docs by task and links one file per stack, such as [llms-fastapi.txt](https://jubasse.github.io/seampact/llms-fastapi.txt).

## The block

```text
## seampact

The API is declared in `contract/` and `seampact.config.yaml`. They are the source of truth.

- Change the API in the contract. Never edit the generated folder (`outDir` in the config): `generate` rewrites it and `check` fails on a hand edit.
- After each contract or config change run these three in order and fix what they print:
  1. `npx seampact lint`
  2. `npx seampact generate`
  3. `npx seampact check`
- Handlers are yours. They implement the generated interfaces. Read the generated types instead of guessing a name or a signature, then run your compiler.
- Every error ends with `Fix:`. Apply it when it edits only your code or the contract syntax. If it removes an operation, a header or an option, or says "not generated yet", stop and ask the user: that changes what the API does.
- One operation, whole: `npx seampact explain <api>.<operationId>`. What a contract edit breaks for clients: `npx seampact diff --against <baseline>`.
- Never hand-write a route, validator, DTO or OpenAPI entry for a contract operation.

Docs by task: https://jubasse.github.io/seampact/llms.txt
Skills, installed with `npx skills add jubasse/seampact`; if your tool does not load skills, read the one that matches before you start:
- `seampact-change-contract`: add or change a route, schema, error, access rule, paging.
- `seampact-implement-handler`: write or fix handler code after `generate`.
- `seampact-fix-error`: any seampact error code or a failed `check`.
- `seampact-setup`: add a target, a framework or a new api.
```

## The four skills

- `seampact-change-contract` adds or changes a route, schema, error, access rule or paging style.
- `seampact-implement-handler` writes the handler code after `generate`.
- `seampact-fix-error` fixes any seampact error code, and tells the agent when to stop and ask you.
- `seampact-setup` installs seampact, adds a target, or moves existing routes.

A tool that loads no skills reads the one that matches, because the block names them.

## What checks the agent

The agent writes the handlers. The compiler tells it where they no longer match the generated interfaces, so the compiler or checker of your language is a fourth check: `npx tsc -p .` on Node, `./gradlew build` on Spring Boot, `php -l` or PHPStan on PHP, mypy or pyright on Python.

- `lint` stops a bad contract.
- `generate` rewrites the types, validators and routes.
- `check` fails when generated code or OpenAPI differs from the contract.

Each message starts with a code such as `check.generated.drift`. Look it up in [troubleshooting](../troubleshooting/README.md).

Next: [write more of the contract](../contract/README.md), or [check it in CI](../features/check-in-ci.md).
