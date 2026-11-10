# The config file

Use `seampact.config.yaml` (an [app](../concepts/glossary.md)'s config) to tell seampact where your contracts are, what to generate and what to check. Run the commands in the app folder. This page shows the three keys you set first; every key is in the [Config reference](reference.md).

## Where the config lives

Put `seampact.config.yaml` in the root of your app, next to its build file: `package.json`, `build.gradle.kts` or `pom.xml`, `composer.json` or `pyproject.toml`. Every path in it is relative to that file. The command reads it from the folder you run it in.

## Choose the generated folder

`outDir` is the one folder for all generated code. Without it, seampact writes to `__generated__` beside the config.

```yaml
outDir: src/__generated__
```

Each target writes to a subfolder named after its `id`. Set `out` on a target to rename it. Each stack uses its own folder: see [Generated files](#generated-files).

## Point to a contract

A source is a name and a place. A local folder:

```yaml
sources:
  notes:
    path: ./contract
```

`notes` here is the name of the source. A target's `apis` lists api names, the `name:` under `api:` in the contract. In this guide both are `notes`.

A contract published by another team, pinned to a version (see [sharing contracts](../features/sharing-contracts.md)). `integrity` is optional and starts with `sha256-`.

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

## Generated files

Where the files go, whether you commit them and who runs `generate` depends on the stack.

| Stack | `outDir` | Commit it? | Who runs `generate` |
|---|---|---|---|
| Node servers and clients | `src/__generated__` | Yes | You, or a script: [`seampact generate`](../features/commands-per-stack.md) |
| Spring Boot, Gradle | A folder under `build/`, such as `build/generated/sources/seampact/main` | No | The build: `./gradlew build` |
| Spring Boot, Maven | `target/generated-sources/seampact` | No | The build: `./mvnw verify` |
| Laravel | `app/Generated` | Yes | You: `vendor/bin/seampact generate` |
| Symfony, API Platform | `src/Generated` | Yes | You: `vendor/bin/seampact generate` |
| FastAPI, Django REST Framework, Django Ninja | `generated` | Yes | You: `seampact generate` |

A folder you commit is the one `seampact check` compares with the contract in CI: [Check in CI](../features/check-in-ci.md). Never edit it by hand. The Gradle check skips an `outDir` under `build/`, since nobody commits it. `outDir` is `__generated__` when you do not set it.

## The entry of your stack

A Node entry lists the apis in `apis: [notes]`. Every other entry names one api in `api: notes` and has no `link`.

| Stack | `use` | Apis |
|---|---|---|
| NestJS, Express, Fastify, Hono, AdonisJS, Next.js | `"@seampact/codegen-nestjs"`, `-express`, `-fastify`, `-hono`, `-adonis`, `-nextjs` | `apis: [notes]` |
| Spring Boot | `io.github.jubasse:seampact-spring-boot` | `api: notes` |
| Laravel | `seampact/laravel` | `api: notes` |
| Symfony | `seampact/symfony` | `api: notes` |
| API Platform | `seampact/api-platform` | `api: notes` |
| FastAPI, DRF, Ninja | `pypi:seampact-fastapi`, `pypi:seampact-drf`, `pypi:seampact-ninja` | `api: notes` |

The full entry of each server is in its guide: [server guides](../README.md#server-guides).

## A full example

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - { id: server, use: "@seampact/codegen-nestjs", apis: [notes] }
checks:
  generated: error
```

## Next

- Next: [Targets and links](targets-and-links.md).
- Every key: [Config reference](reference.md). Also: [validators](validators.md), [OpenAPI and docs](openapi-and-docs.md), [checks](../features/check-in-ci.md), [monorepo](monorepo.md).
