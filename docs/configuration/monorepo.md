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
