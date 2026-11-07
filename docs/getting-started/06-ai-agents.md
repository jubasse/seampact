# Work with an AI agent

The contract and the config are the source of truth. Give the agent two things: a short block of rules in `AGENTS.md`, and four skills it reads when it needs them. Then seampact checks its work.

## Install them on Node

```sh
npx seampact agents install
```

This does two things:

- It writes the block below into `AGENTS.md`, between two marker lines. The text outside the markers is never touched.
- It copies the four skills into `.agents/skills/`.

Add `--claude` to copy the skills into `.claude/skills/` too, for Claude Code. Add `--skills-directory <dir>` to choose another folder.

Run it again after you upgrade seampact. It rewrites only the block and the `seampact-` skill folders, so a skill an older version shipped goes away. It refuses to write through a symbolic link.

## Install them on other stacks

`agents install` needs the Node CLI. On Gradle, Maven, PHP and Python, do it by hand:

1. Copy the block below into `AGENTS.md`.
2. Replace `npx seampact` with the line for your stack: see [commands per stack](../features/commands-per-stack.md). The compiler binary has no `generate` or `check`; use the build command of your stack there.
3. Copy the [skills folder](https://github.com/jubasse/seampact/tree/develop/skills) into `.agents/skills/`: Codex and Cursor read it. Claude Code reads `.claude/skills/`, so copy them there too.

Each skill has a `references/` folder. You only need the file of your own stack. Delete the others if you like.

An agent that reads the web can start from [llms.txt](https://jubasse.github.io/seampact/llms.txt): it lists the docs by task and links one file per stack, such as [llms-fastapi.txt](https://jubasse.github.io/seampact/llms-fastapi.txt).

## The block

```md
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
Skills in `.agents/skills/`; if your tool does not load skills, read the one that matches before you start:
- `seampact-change-contract/SKILL.md`: add or change a route, schema, error, access rule, paging.
- `seampact-implement-handler/SKILL.md`: write or fix handler code after `generate`.
- `seampact-fix-error/SKILL.md`: any seampact error code or a failed `check`.
- `seampact-setup/SKILL.md`: add a target, a framework or a new api.
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
