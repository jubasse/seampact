---
name: seampact-setup
description: Install seampact, add a server or client target, add a new api, or move the routes of an existing app to seampact. Use for "set up seampact", "add seampact to this project", "generate a client for this API", "add a FastAPI/Laravel/NestJS/Next.js/Spring target", "move this route to a contract". Not for editing an existing contract (seampact-change-contract) or for an error (seampact-fix-error).
---

# Set up seampact

1. Find the stack. Look for `package.json`, `composer.json`, `pom.xml`, `build.gradle*` and `pyproject.toml`, and for an existing `seampact.config.yaml`. If the repo has several stacks, ask the user which one to set up.
2. Read `references/commands.md`: it gives the command line of each stack. Only Node has `init`; on the other stacks you write `seampact.config.yaml` by hand.
3. New project on Node: follow `references/install.md`, then `npx seampact init`. It writes `seampact.config.yaml` and `contract/api.yaml`.
4. Add the target of your stack. Open its one reference in this skill's `references/` (`nestjs.md`, `express.md`, `fastify.md`, `hono.md`, `adonisjs.md`, `spring-boot.md`, `laravel.md`, `symfony.md`, `fastapi.md`, `drf.md`, `ninja.md`, `nextjs.md` or `api-platform.md`). It gives the install line, the `targets` entry and the wiring.
5. An app that already has routes: move one route at a time, as `references/existing-project.md` shows. Keep every other route as it is, and keep the old route until `check` and your own tests pass on the new one.
6. Run `lint`, then `generate`, then `check`, and commit the generated files with the contract. Fix errors with `seampact-fix-error`; write the handlers with `seampact-implement-handler`.
7. Add the seampact block to AGENTS.md so the next agent finds the rules: copy the block from https://jubasse.github.io/seampact/getting-started/06-ai-agents/.

## Stop and ask the user

- before you replace a route that clients already call;
- before you pick the framework, the validator or the paging style for a repo that gives no hint.
