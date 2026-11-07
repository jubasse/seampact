<!-- Generated from docs/troubleshooting/README.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Troubleshooting

Page: https://jubasse.github.io/seampact/troubleshooting/

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

Search this page or the page index for the code (`seampact/load/yaml-boolean`). A message of the generated server starts with `seampact: the api '<id>' cannot start:` and has no code: see [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/). Each message has a `Fix:`. Read it first.

## Find the page

| The code starts with | You are | Page |
|---|---|---|
| `config.`, `framework.` | reading `seampact.config.yaml`: file, sources, targets, output, framework versions | [Config errors](https://jubasse.github.io/seampact/troubleshooting/config/) |
| `config.root.`, `config.apps.`, `config.app.`, `config.openapi.`, `openapi.document.` | using a monorepo root or the `openapi` key | [Monorepo and OpenAPI errors](https://jubasse.github.io/seampact/troubleshooting/config-root/) |
| `link.` | linking target entries | [Link errors](https://jubasse.github.io/seampact/troubleshooting/link/) |
| `bundle.` (except `bundle.source.`) | publishing or reading a contract bundle | [Bundle errors](https://jubasse.github.io/seampact/troubleshooting/bundle/) |
| `check.`, `writer.`, `file.` | running `check` or `generate` on files that changed | [Check errors](https://jubasse.github.io/seampact/troubleshooting/check/) |
| `seampact/load/` | reading your contract YAML | [Contract file errors](https://jubasse.github.io/seampact/troubleshooting/load/) |
| `seampact/validate/` | writing a key or value the grammar does not allow | [Contract key errors](https://jubasse.github.io/seampact/troubleshooting/validate/) |
| `seampact/tree/` | wiring routes, schemas, paths and lists | [Contract content errors](https://jubasse.github.io/seampact/troubleshooting/tree/) |
| `seampact/access/`, `seampact/derive/` | access, identities, rights, error codes, cache | [Access, error code and throttle errors](https://jubasse.github.io/seampact/troubleshooting/access-and-errors/) |
| `seampact/<rule>` such as `seampact/unused-declaration` | linting | [Lint](https://jubasse.github.io/seampact/features/lint/) |
| `signature.` | verifying a signed webhook with a seampact helper | [Signed webhook errors](https://jubasse.github.io/seampact/troubleshooting/signed-webhooks/) |
| `cli.`, `init.`, `lint.`, `diff.`, `explain.`, `compile.`, `binary.`, `ir.`, `bundle.source.` | running a command, or the Gradle or Maven plugin | [CLI errors](https://jubasse.github.io/seampact/troubleshooting/cli/) |
| `options.`, `names.`, `paging.`, `runtime.`, `artefact.`, `artefacts.`, `nativeDocs.`, `openapi.<form>.unsupported`, or any code ending in `.unsupported` | running `generate` | [Generate errors](https://jubasse.github.io/seampact/troubleshooting/generate/) |
| `seampact: the api '...' cannot start` | starting the generated server | [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/) |

If no prefix matches, search the files of `docs/troubleshooting/` for the full code.

## Generate errors by family

[Generate errors](https://jubasse.github.io/seampact/troubleshooting/generate/) has one table per family: [Clients](https://jubasse.github.io/seampact/troubleshooting/generate/#clients), [Node servers](https://jubasse.github.io/seampact/troubleshooting/generate/#node-servers), [Spring Boot](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot), [PHP](https://jubasse.github.io/seampact/troubleshooting/generate/#php), [Python](https://jubasse.github.io/seampact/troubleshooting/generate/#python), [Spring Boot, PHP and Python](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python), [Every server](https://jubasse.github.io/seampact/troubleshooting/generate/#every-server), [Every Node target](https://jubasse.github.io/seampact/troubleshooting/generate/#every-node-target), [OpenAPI documents](https://jubasse.github.io/seampact/troubleshooting/generate/#openapi-documents) and [Warnings](https://jubasse.github.io/seampact/troubleshooting/generate/#warnings).

## Errors with no code

| You see | Cause and fix |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package or its version is not on the registry. Check the name and the version, and keep every `@seampact/*` package at the same version ([Install](https://jubasse.github.io/seampact/getting-started/01-install/)). |
| `Plugin [id: 'io.github.jubasse.seampact'] was not found in any of the following sources` | Gradle: the plugin repositories do not hold the version. While the Plugin Portal reviews a release, add Maven Central to `pluginManagement.repositories` ([Spring Boot](https://jubasse.github.io/seampact/backend/spring-boot/#set-up)). |
| `Could not find a matching version of package seampact/laravel` | Composer: the package or its version is not found. Check the name and the version ([Laravel](https://jubasse.github.io/seampact/backend/laravel/), [Symfony](https://jubasse.github.io/seampact/backend/symfony/)). |
| `No matching distribution found for seampact-fastapi` | pip: the package or its version is not found, or Python is older than 3.12. Check the name, the version and `python --version` ([Python guides](https://jubasse.github.io/seampact/backend/fastapi/)). |
