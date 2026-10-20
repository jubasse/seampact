# Check in CI

Fail the build when the generated code or the OpenAPI document no longer matches the contract. Run the command in the app folder.

Change the contract (see [diff](diff.md)), then check the generated code.

```sh
npx seampact check
```

You see `check.generated.drift`. Run `npx seampact generate` to fix it.

The checks and their levels: [checks](../configuration/checks.md).

Next: [`docs/grammar/`](../grammar/) describes every contract key, and [`example.md`](../grammar/example.md) is a full contract.
