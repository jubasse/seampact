# Monorepo

One config at the root runs every app.

A `seampact.config.yaml` at the root lists the apps. Each app keeps its own config.

```yaml
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
  - { id: queries, use: "@seampact/codegen-react", apis: [notes], options: { query: tanstack }, link: { client: client } }
# admin/seampact.config.yaml
  - { id: queries, use: "@seampact/codegen-react", apis: [notes], options: { query: swr }, link: { client: client } }
```
