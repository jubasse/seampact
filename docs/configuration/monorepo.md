# Monorepo

Use a root config to run every app of a monorepo with one command and to write merged OpenAPI documents. A `seampact.config.yaml` at the root lists the apps. Each app keeps its own config.

```yaml
# seampact.config.yaml at the repository root
sources:
  notes:
    path: ./contract
apps: [notes-app]
openapi:
  all:
    path: openapi/all.yaml
checks:
  openapi: error
```

Run `seampact generate` and `seampact check` from the root: they run every app, then write the merged document `all`.

Each app picks its own stack. Two frontends of one root can use different query libraries, in their own configs:

```yaml
# web/seampact.config.yaml
targets:
  - { id: queries, use: "@seampact/codegen-react", apis: [notes], options: { query: tanstack }, link: { client: client } }
```

```yaml
# admin/seampact.config.yaml
targets:
  - { id: queries, use: "@seampact/codegen-react", apis: [notes], options: { query: swr }, link: { client: client } }
```

Root keys: [Config reference](reference.md#root-config).

## Next

- Next: [Check it in CI](../features/check-in-ci.md).
