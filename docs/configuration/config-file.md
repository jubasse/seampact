# The config file

Use `seampact.config.yaml` to tell seampact where your contracts are, what to generate and what to check. Run the commands in the app folder. This page shows the three keys you set first; every key is in the [Config reference](reference.md).

## Where the config lives

Put `seampact.config.yaml` in the root of your app, next to `package.json`. Every path in it is relative to that file. The CLI reads it from the folder you run it in.

## Choose the generated folder

`outDir` is the one folder for all generated code. Without it, seampact writes to `__generated__` beside the config.

```yaml
outDir: src/__generated__
```

Each target writes to a subfolder named after its `id`. Set `out` on a target to rename it.

## Point to a contract

A source is a name and a place. A local folder:

```yaml
sources:
  notes:
    path: ./contract
```

`notes` here is the name of the source. A target's `apis` lists api names, the `name:` under `api:` in the contract. In this guide both are `notes`.

A contract published by another team, pinned to a version (see [sharing contracts](../features/sharing-contracts.md)). `integrity` is optional and starts with `sha256-`.

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

## A full example

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - { id: server, use: "@seampact/codegen-nestjs", apis: [notes] }
checks:
  generated: error
```

## Next

- Next: [Targets and links](targets-and-links.md).
- Every key: [Config reference](reference.md). Also: [validators](validators.md), [OpenAPI and docs](openapi-and-docs.md), [checks](../features/check-in-ci.md), [monorepo](monorepo.md).
