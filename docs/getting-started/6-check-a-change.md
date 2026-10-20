# 6. Check a change

See what a contract edit breaks before you ship it. Run the commands in the app folder.

Save the current contract as a baseline, then edit the contract.

```sh
npx seampact compile --out baseline
```

Add `author` to `CreateNote`: `required: [title, author]` and `author: { type: string }` under `properties`. Then compare.

```sh
npx seampact diff --against baseline
```

You see `breaking clients createNote input ...: property.added required (author)`: existing clients do not send `author`. The gate passes because the contract sets no `compat` policy; add `compat: { policy: additive-only }` under `api:` and the gate fails.

Now check the generated code.

```sh
npx seampact check
```

You see `check.generated.drift`. Run `npx seampact generate` to fix it.

Next: [`docs/grammar/`](../grammar/) describes every contract key, and [`example.md`](../grammar/example.md) is a full contract.
