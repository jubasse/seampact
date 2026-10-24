# Troubleshooting

Find your error by its code. The code is the first word of the message, such as `config.schema` or `seampact/tree/schema-unknown`.

| Code starts with | You are | Page |
|---|---|---|
| `config.` | reading `seampact.config.yaml`: file, sources, targets, output, framework versions | [Config errors](config.md) |
| `config.root.`, `config.apps.`, `config.openapi.`, `openapi.document.` | using a monorepo root or the `openapi` key | [Monorepo and OpenAPI errors](config-root.md) |
| `link.` | linking target entries | [Link errors](link.md) |
| `bundle.` | publishing or reading a contract bundle | [Bundle errors](bundle.md) |
| `options.`, `paging.` | setting a target's `options`, or reading a generate warning | [Target option errors](generate.md) |
| `check.`, `writer.` | running `check` or `generate` on files that changed | [Check errors](check.md) |
| `seampact/load/` | reading your contract YAML | [Contract file errors](load.md) |
| `seampact/validate/` | writing a key or value the grammar does not allow | [Contract key errors](validate.md) |
| `seampact/tree/` | wiring routes, schemas, paths and lists | [Contract content errors](tree.md) |
| `seampact/access/`, `seampact/derive/` | access, identities, rights, error codes, cache | [Access and error code errors](access-and-errors.md) |
| `seampact/unused-declaration` and other `seampact/<rule>` | linting | [Lint](../features/lint.md) |
| `seampact: the api '...' cannot start` | starting the generated server | [Boot errors](boot.md) |
| `cli.`, `lint.`, `diff.`, `explain.`, `binary.`, `compile.` | running a command | [CLI errors](cli.md) |

Errors with no code:

| You see | Do |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package is missing from `pnpm-workspace.yaml` `overrides`: rerun `install-into.ts` from [Install](../getting-started/01-install.md). |

Each message ends with `Fix:`. Read it first.
