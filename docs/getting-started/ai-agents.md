# Work with an AI agent

The contract and the config are the source of truth. Give them to the agent, and let seampact check its work.

1. Point the agent at `contract/` and `seampact.config.yaml`. A change to the API starts in the contract, not in the code.
2. Tell it never to edit `__generated__`. Generated files are rewritten by `generate`; `check` fails on a hand edit.
3. Ask it to run these after each change.

```sh
npx seampact lint
npx seampact generate
npx seampact check
```

- `lint` stops a bad contract.
- `generate` rewrites the types, validators and routes.
- `check` fails when generated code or OpenAPI differs from the contract.

To see what a contract edit breaks for clients, ask for `npx seampact diff --against baseline` (see [diff](../features/diff.md)).

The agent writes the handlers. The compiler tells it where they no longer match the generated interfaces, so `npx tsc -p .` is a fourth check.

Each message has a rule id such as `check.generated.drift`. Look it up in [troubleshooting](../troubleshooting/README.md).
