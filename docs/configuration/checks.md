# Checks

`seampact check` compares what the contract produces with what is on disk.

Set each check to `error` (fails, the default), `warning` (reports) or `disabled`.

```yaml
checks:
  generated: error
  openapi: warning
  matrix: warning
```

- `generated`: a generated file differs from the contract (`check.generated.drift`).
- `openapi`: an OpenAPI document differs (`check.openapi.drift`).
- `matrix`: a framework version seampact has not tested. It takes `error` or `warning`. For the React target it also checks React 19 and the query library the `query` option picks: TanStack Query 5, SWR 2, or Redux Toolkit 2 with React Redux 9.

You see `check: the generated files and documents match the committed ones.` when nothing drifted.
