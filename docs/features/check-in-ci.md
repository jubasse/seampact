# Check in CI

Use `seampact check` in CI to fail the build when the generated code or an OpenAPI document no longer matches the contract. Run the commands in the app folder.

## Try it locally

Change the contract (see [diff](diff.md)), then check the generated code.

```sh
npx seampact check
```

You see `check.generated.drift`. `check` exits with 1 on drift. Run `npx seampact generate` to fix it. When nothing drifted you see `check: the generated files and documents match the committed ones.`

## Run it in GitHub Actions

```yaml
# .github/workflows/seampact.yml
name: seampact
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx seampact lint
      - run: npx seampact check
```

To also fail on a breaking contract change, add a step with `npx seampact diff --against <baseline>`: see [Diff](diff.md).

## Set the levels

Set each check to `error` (fails), `warning` (reports) or `disabled`. Put them under `checks` in `seampact.config.yaml`.

```yaml
checks:
  generated: error
  openapi: error
  matrix: warning
```

- `generated` (default `error`): a generated file differs from the contract (`check.generated.drift`).
- `openapi` (default `error`): an OpenAPI document differs (`check.openapi.drift`).
- `matrix` (default `warning`, takes `error` or `warning`, not `disabled`): a framework version seampact has not tested. For the React target it also checks React 19 and the query library the `query` option picks: TanStack Query 5, SWR 2, or Redux Toolkit 2 with React Redux 9.

Every key: [Config reference](../configuration/reference.md#checks).

## Next

Next: [Add seampact to an existing app](../getting-started/04-existing-project.md), or [write more of the contract](../contract/README.md).
