# Troubleshooting

Find your error by its code, then open the page for that code.

## Read an error

A contract or config error prints the file, the line, the column, a severity, the code and the message:

```text
api.yaml:5:13: error seampact/load/yaml-boolean: ...
```

Search this page or the page index for the code (`seampact/load/yaml-boolean`). A message of the generated server starts with `seampact: the api '<id>' cannot start:` and has no code: see [Boot errors](boot.md). Each message ends with `Fix:`. Read it first.

## Find the page

| The code starts with | You are | Page |
|---|---|---|
| `config.`, `framework.` | reading `seampact.config.yaml`: file, sources, targets, output, framework versions | [Config errors](config.md) |
| `config.root.`, `config.apps.`, `config.app.`, `config.openapi.`, `openapi.document.` | using a monorepo root or the `openapi` key | [Monorepo and OpenAPI errors](config-root.md) |
| `link.` | linking target entries | [Link errors](link.md) |
| `bundle.` (except `bundle.source.`) | publishing or reading a contract bundle | [Bundle errors](bundle.md) |
| `check.`, `writer.`, `file.` | running `check` or `generate` on files that changed | [Check errors](check.md) |
| `seampact/load/` | reading your contract YAML | [Contract file errors](load.md) |
| `seampact/validate/` | writing a key or value the grammar does not allow | [Contract key errors](validate.md) |
| `seampact/tree/` | wiring routes, schemas, paths and lists | [Contract content errors](tree.md) |
| `seampact/access/`, `seampact/derive/` | access, identities, rights, error codes, cache | [Access, error code and throttle errors](access-and-errors.md) |
| `seampact/<rule>` such as `seampact/unused-declaration` | linting | [Lint](../features/lint.md) |
| `signature.` | verifying a signed webhook with a seampact helper | [Signed webhook errors](signed-webhooks.md) |
| `cli.`, `init.`, `lint.`, `diff.`, `explain.`, `compile.`, `binary.`, `ir.`, `bundle.source.` | running a command, or the Gradle or Maven plugin | [CLI errors](cli.md) |
| `options.`, `names.`, `paging.`, `runtime.`, `artefact.`, `artefacts.`, `nativeDocs.`, or a form named like `input.multipart.unsupported` | running `generate` | [Generate errors](generate.md) |
| `seampact: the api '...' cannot start` | starting the generated server | [Boot errors](boot.md) |

If no prefix matches, search the files of `docs/troubleshooting/` for the full code.

## Generate errors by family

[Generate errors](generate.md) has one table per family: [Clients](generate.md#clients), [Node servers](generate.md#node-servers), [Spring Boot](generate.md#spring-boot), [PHP](generate.md#php), [Python](generate.md#python), [Every server](generate.md#every-server) and [Warnings](generate.md#warnings).

## Errors with no code

| You see | Cause and fix |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package or its version is not on the registry. Check the name and the version, and keep every `@seampact/*` package at the same version ([Install](../getting-started/01-install.md)). |
