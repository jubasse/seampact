# Troubleshooting

Find your error by its code, then open the page for that code.

## Read an error

A contract or config error prints the file, the line, the column, a severity, the code and the message:

```text
api.yaml:5:13: error seampact/load/yaml-boolean: ...
```

A `generate` refusal starts with the contract line when it has one, and ends with the docs section of its code:

```text
api.yaml:10: paging.sort.style.unsupported: entry 'server', api 'notes': ... Fix: Ask the user first: ... Docs: https://jubasse.github.io/seampact/troubleshooting/generate/#node-servers
```

A fix that starts with "Ask the user first:" changes the api: ask before you apply it.

Search this page or the page index for the code (`seampact/load/yaml-boolean`). A message of the generated server starts with `seampact: the api '<id>' cannot start:` and has no code: see [Boot errors](boot.md). Each message has a `Fix:`. Read it first.

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
| `options.`, `names.`, `paging.`, `runtime.`, `artefact.`, `artefacts.`, `nativeDocs.`, `openapi.<form>.unsupported`, or any code ending in `.unsupported` | running `generate` | [Generate errors](generate.md) |
| `seampact: the api '...' cannot start` | starting the generated server | [Boot errors](boot.md) |

If no prefix matches, search the files of `docs/troubleshooting/` for the full code.

## Generate errors by family

[Generate errors](generate.md) has one table per family: [Clients](generate.md#clients), [Node servers](generate.md#node-servers), [Spring Boot](generate.md#spring-boot), [PHP](generate.md#php), [Python](generate.md#python), [Spring Boot, PHP and Python](generate.md#spring-boot-php-and-python), [Every server](generate.md#every-server), [Every Node target](generate.md#every-node-target), [OpenAPI documents](generate.md#openapi-documents) and [Warnings](generate.md#warnings).

## Errors with no code

| You see | Cause and fix |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package or its version is not on the registry. Check the name and the version, and keep every `@seampact/*` package at the same version ([Install](../getting-started/01-install.md)). |
| `Plugin [id: 'io.github.jubasse.seampact'] was not found in any of the following sources` | Gradle: the plugin repositories do not hold the version. When the Plugin Portal does not serve the release yet, add Maven Central to `pluginManagement.repositories` ([Spring Boot](../backend/spring-boot.md#set-up)). |
| `Could not find a matching version of package seampact/laravel` | Composer: the package or its version is not found. Check the name and the version ([Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md)). |
| `No matching distribution found for seampact-fastapi` | pip: the package or its version is not found, or Python is older than 3.12. Check the name, the version and `python --version` ([Python guides](../backend/fastapi.md)). |
