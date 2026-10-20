# The config file

`seampact.config.yaml` tells seampact where your contracts are, what to generate and what to check. Run the commands in the app folder.

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

A contract published by another team, pinned to a version (see [sharing contracts](../features/sharing-contracts.md)). `integrity` is optional and starts with `sha256-`.

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

Other pages: [targets and links](targets-and-links.md), [validators](validators.md), [OpenAPI and docs](openapi-and-docs.md), [checks](checks.md), [monorepo](monorepo.md).
