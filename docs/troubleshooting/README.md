# Troubleshooting

| You see | Do |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package is missing from `pnpm-workspace.yaml` `overrides`: rerun `install-into.ts` from [Install](../getting-started/install.md). |
| `config.source.no-workspace` | The `path` folder holds neither `workspace.yaml` nor `api.yaml`. |
| `check.generated.drift ... edited by hand` | Move your code out of `src/__generated__`, delete the edited file, run `generate`. |
| Boot error `framework route ... not allow-listed` | List the route under `frameworkRoutes` of the server target, with a reason. |
| `cli.not-available` | The command (`init`, `bundle`, `explain`) is planned. |
