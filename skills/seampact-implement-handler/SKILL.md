---
name: seampact-implement-handler
description: Write or fix the handler code behind a seampact-generated API. Use for "implement this endpoint", "write the handler for listNotes", a typecheck or compile error after `generate`, "my handler does not match the generated interface". Also use in any repo that holds seampact.config.yaml and a generated folder. Not for contract edits (seampact-change-contract) and not for a seampact error code (seampact-fix-error).
---

# Implement a handler

The generated code fixes the interface. The handler is yours: it receives a checked, typed request and returns one declared result.

1. Run `generate` first, so the types match the contract (command lines are in AGENTS.md).
2. Find the stack: the `use:` of the server target in `seampact.config.yaml`. Open the one reference for it, and no other:
   `references/nestjs.md`, `express.md`, `fastify.md`, `hono.md`, `adonisjs.md`, `spring-boot.md`, `laravel.md`, `symfony.md`, `fastapi.md`, `drf.md` or `ninja.md`.
3. Read the generated types of the operation in the generated folder (`outDir` in the config). Copy the names and signatures you find there; do not guess them. For one operation whole, with the file and line each part comes from, run `seampact explain <api>.<operationId>`.
4. Write the handler beside your own code, not in the generated folder. Return one arm of the generated result, or a declared error. Never write a status code or a content type.
5. Map your own models to the contract's type before you return them. A reply that breaks the contract answers 500.
6. Check your work with the compiler of your language: `npx tsc -p .` on Node, `./gradlew build` on Spring Boot, `php -l` or PHPStan on PHP, mypy or pyright on Python. Fix your code until it passes. A new resource, right or scope also needs wiring: the reference's "Wire it in" section shows it.

## Rules that save a round trip

- A failure the API should name is a declared error in the contract, returned by the handler. Do not throw a bare exception for it.
- A paged list returns the generated page type with its items and page facts; the boundary writes the body, the headers and the links. The reference for your stack shows the call.
- The caller (`principal`) and the scopes come from the request, never from the input.
- A handler never reads or writes a generated file.

## Stop and ask the user

- when the handler needs a field, an error or a status the contract does not declare: that is a contract change, so switch to `seampact-change-contract` after the user agrees;
- when the generated types look wrong: run `generate` again and `check` before you suspect the contract.
