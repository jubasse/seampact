# Work with an AI agent

The contract and the config are the source of truth. Give them to the agent, and let seampact check its work.

1. Point the agent at `contract/` and `seampact.config.yaml`. A change to the API starts in the contract, not in the code.
2. Tell it never to edit the generated folder (`outDir` in the config: `src/__generated__` on Node). Generated files are rewritten by `generate`; `check` fails on a hand edit.
3. Ask it to run these after each change.

```sh
seampact lint
seampact generate
seampact check
```

Each command is `npx seampact <command>` on Node. On the other stacks the line differs: see [commands per stack](../features/commands-per-stack.md).

- `lint` stops a bad contract.
- `generate` rewrites the types, validators and routes.
- `check` fails when generated code or OpenAPI differs from the contract.

To see what a contract edit breaks for clients, ask for `seampact diff --against baseline` (see [diff](../features/diff.md)).

To show an agent one operation whole, with where each part comes from, give it `seampact explain notes.getNote` (Node CLI or the compiler binary).

The agent writes the handlers. The compiler tells it where they no longer match the generated interfaces, so the compiler or checker of your language is a fourth check: `npx tsc -p .` on Node, `./gradlew build` on Spring Boot, `php -l` or PHPStan on PHP, mypy or pyright on Python.

Each message starts with a code such as `check.generated.drift`. Look it up in [troubleshooting](../troubleshooting/README.md).

Next: [write more of the contract](../contract/README.md), or [check it in CI](../features/check-in-ci.md).
