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
- `matrix`: a framework version seampact has not tested. It takes `error` or `warning`.

You see `check: the generated files and documents match the committed ones.` when nothing drifted.
