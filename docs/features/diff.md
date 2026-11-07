# Diff a contract change

See what a contract edit breaks before you ship it. Run the commands in the app folder.

Save the current contract as a baseline, then edit the contract.

```sh
npx seampact compile --out baseline
```

The `baseline` folder is a working copy: add it to `.gitignore`.

Add `author` to `CreateNote`: `required: [title, author]` and `author: { type: string }` under `properties`. Then compare.

```sh
npx seampact diff --against baseline
```

You see `breaking clients createNote input ...: property.added required (author)`. Existing clients do not send `author`.

To make `diff` fail on breaking changes, add `compat: { policy: additive-only }` under `api:`.

Next: [check in CI](check-in-ci.md).
