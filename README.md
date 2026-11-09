<p align="center">
  <img src="packages/tools/docs-site/site/assets/logo.svg" alt="seampact logo: an abstract S made of an API document, a ribbon and a layer of code" width="160">
</p>

# seampact

**Declare your API once in YAML. Get typed handlers, validators, OpenAPI and clients for your own framework.**

Read the documentation at **[jubasse.github.io/seampact](https://jubasse.github.io/seampact/)**.

[![CI](https://img.shields.io/github/actions/workflow/status/jubasse/seampact/ci.yml?branch=develop&label=CI)](https://github.com/jubasse/seampact/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-jubasse.github.io%2Fseampact-0a7bbb.svg)](https://jubasse.github.io/seampact/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933.svg)](docs/getting-started/01-install.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?logo=typescript&logoColor=white)](docs/concepts/packages.md)
[![npm](https://img.shields.io/npm/v/@seampact/cli.svg?label=npm)](https://www.npmjs.com/package/@seampact/cli)

## Why seampact

- **One contract, no drift.** Types, validators, OpenAPI and clients all come from the same YAML.
- **Code you can read.** The output uses your framework's own mechanisms, in one `__generated__` folder.
- **Checked before your handler runs.** Input is validated and errors answer in one `problem+json` format.
- **Access at the boundary.** Every route states who may call it, and the app refuses to start without a hook for it.
- **Safe changes.** `seampact check` and `seampact diff` catch drift and breaking changes in CI.
- **Your tools keep working.** Swagger, Ajv and VineJS stay in place.

## What it generates

From one YAML contract:

| Output | What you get |
|---|---|
| Types | One TypeScript type per schema, request and reply. |
| Validators | zod, yup, class-validator, VineJS or Ajv schemas that check every input. |
| Server boundary | Routes for NestJS, Express, Fastify, AdonisJS, Hono, Spring Boot, Laravel, Symfony, FastAPI, Django REST Framework or Django Ninja. They validate input, call your access hooks, and check each reply against the contract before it is sent. |
| Built-in rules | Paging, rate limits, idempotency keys, ETags, CSRF, signed requests and field rights, declared in the contract and enforced at the boundary. You plug in the stores and decisions. |
| Errors | One error format, RFC 9457 `problem+json` by default, with typed error codes per route. |
| Clients | A typed `fetch` client (or over your own axios instance), hooks for React (TanStack Query, SWR, RTK Query), composables for Vue (TanStack Query, Pinia Colada), an Angular service with NgRx effects as an option, and MSW mocks to test them with no backend. |
| Docs | OpenAPI 3.1 documents, and on NestJS, Fastify and FastAPI your framework's own Swagger kept in line with the contract. |
| Editor support | Schemas that complete and check the contract's names as you type. |

From the CLI:

| Command | What it does |
|---|---|
| `seampact init` | Starts a project: a config and an example contract. |
| `seampact generate` | Writes the code above into `__generated__`. |
| `seampact check` | Fails CI when generated files or documents differ from the contract. |
| `seampact diff` | Classifies the changes between two versions and fails on a breaking one. |
| `seampact lint` | Reports contract mistakes before you generate. |
| `seampact explain tasks.updateTask` | Prints one route whole: params, rules, errors, and where each one comes from. |
| `seampact bundle` | Packs a contract so other repositories, Node or JVM, pin and reuse it. |

## Example

One YAML file describes the API:

```yaml
schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      createdAt: { type: string, format: date-time }

surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops: { get: {} }
```

The handler you write, typed by the contract. Express here; every server works the same way:

```ts
export const notesHandlers: NotesExpress.NotesEndpoints = {
  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },
};
```

Each server and client has a guide, with its handler, its checks and its tests: see [Supported stacks](#supported-stacks).

The full walk-through is in [Get started](docs/getting-started/README.md).

## Supported stacks

### Servers

| Server | Versions | Validators |
|---|---|---|
| [NestJS](docs/backend/nestjs.md) | 12 | zod, yup, class-validator |
| [Express](docs/backend/express.md) | 4, 5 | zod, yup |
| [Fastify](docs/backend/fastify.md) | 5 | zod, yup, Ajv |
| [AdonisJS](docs/backend/adonisjs.md) | 7 (6 still works but is no longer maintained, see [Supported versions](docs/supported-versions.md)) | zod, yup, VineJS |
| [Hono](docs/backend/hono.md) | 4 | zod, yup |
| [Spring Boot](docs/backend/spring-boot.md) | 4 | generated checks, Jakarta constraints on the records |
| [Symfony](docs/backend/symfony.md) | 7.4, 8 | generated checks, Symfony Validator constraints on the inputs |
| [API Platform](docs/backend/api-platform.md) | 5, on Symfony 7.4 and 8 (PHP 8.3 to 8.5) | generated checks |
| [Laravel](docs/backend/laravel.md) | 13 (PHP 8.3 to 8.5) | generated `FormRequest` rules, Laravel's own value rules by default |
| [FastAPI](docs/backend/fastapi.md) | 0.162 (Python 3.12 or later) | generated checks, Pydantic models, Pydantic's own value rules by default |
| [Django REST Framework](docs/backend/drf.md) | 3.18, on Django 5.2 and 6 (Python 3.12 or later) | generated checks and serializers, DRF's own field arguments by default |
| [Django Ninja](docs/backend/ninja.md) | 1.5.3 and later, on Django 5.2 and 6 (Python 3.12 or later) | generated checks, Pydantic models, Pydantic's own value rules by default |

Spring Boot 4 is generated at build time by the Gradle plugin `io.github.jubasse.seampact` or the Maven plugin `seampact-maven-plugin`. It can also generate Spring Security matchers and refusals, and springdoc annotations. Laravel 13 is generated by `vendor/bin/seampact generate` (installed with Composer from Packagist) or `php artisan seampact:generate` (see [Laravel](docs/backend/laravel.md)). Symfony (PHP 8.3 to 8.5) is generated with `seampact/symfony`: see the [Symfony guide](docs/backend/symfony.md). FastAPI, Django REST Framework and Django Ninja are generated by `seampact generate` of the Python package (`pypi:seampact-fastapi`, `pypi:seampact-drf` or `pypi:seampact-ninja` in the entry's `use`, installed from PyPI): see the [FastAPI guide](docs/backend/fastapi.md), the [Django REST Framework guide](docs/backend/drf.md) and the [Django Ninja guide](docs/backend/ninja.md). The compiler binary comes with the `seampact-ir` wheel.

### Clients

| Framework | Versions | Query tools |
|---|---|---|
| [Typed `fetch` client](docs/frontend/fetch-client.md) | any framework or none | none |
| [Axios client](docs/frontend/axios-client.md) | axios 1.7 or later, over the `fetch` client | none |
| [React](docs/frontend/react.md) | 19 | TanStack Query 5, SWR 2, RTK Query 2, or none |
| [Vue](docs/frontend/vue.md) | 3 | TanStack Query 5, Pinia Colada 1, or none |
| [Angular](docs/frontend/angular.md) | 22 | none: a service over `HttpClient`, with NgRx 22 actions and effects or NgRx Signals 22 store features as an option |
| [MSW mocks](docs/frontend/msw.md) | 2 | none: handlers for `setupServer` and `setupWorker` |

When a version is supported, and when it is dropped: see [Supported versions](docs/supported-versions.md).

## Get started

- [Getting started](docs/getting-started/README.md): a notes API on the server of your choice, in four steps.
- [Server guides](docs/README.md#server-guides): one page per framework, from setup to tests, including [FastAPI](docs/backend/fastapi.md), [Django REST Framework](docs/backend/drf.md) and [Django Ninja](docs/backend/ninja.md).
- [Configuration](docs/configuration/config-file.md): every key of `seampact.config.yaml`.
- [Troubleshooting](docs/troubleshooting/README.md).
- [Coding agents](docs/getting-started/06-ai-agents.md): an `AGENTS.md` block, four skills, and `llms.txt` with one file per stack.

## Status

The reference contract runs end to end on every server above. Every package is on its registry, at one version:

```sh
npm install --save-dev @seampact/cli @seampact/codegen-ts
composer require seampact/laravel seampact/hooks
pip install "seampact-fastapi[generate]"
```

Gradle, Maven and the compiler binary are in [Install in other ecosystems](docs/getting-started/install-other-ecosystems.md). The [release notes](docs/release-notes/README.md) say what each release ships; the [1.0.0 notes](docs/release-notes/1.0.0.md) list what 1.0 refuses by name. See the [roadmap](docs/roadmap.md).

## More docs

Every page is listed in [docs/README.md](docs/README.md).

## Roadmap

- [x] Node servers: NestJS, Express, Fastify, AdonisJS, Hono
- [x] CLI: `init`, `generate`, `check`, `lint`, `diff`, `bundle`, `explain`, editor schemas (`compile --editor-schemas`)
- [x] Frontend: React hooks (TanStack Query, SWR, RTK Query, or no query library)
- [x] Frontend: Vue composables (TanStack Query, Pinia Colada, or no query library)
- [x] Frontend: Angular service over `HttpClient` (no query library)
- [x] Frontend: NgRx actions and effects for Angular
- [x] Frontend: NgRx Signal Store features for Angular
- [x] Frontend: MSW mocks
- [x] Java: Spring Boot 4, with a Gradle and a Maven plugin, Spring Security and springdoc
- [x] PHP: Symfony 7.4 and 8, with SecurityBundle and RateLimiter
- [x] PHP: Laravel 13, with Guards, Sanctum, Gates and Policies
- [x] Python: FastAPI 0.162 and later, Django REST Framework 3.18, and Django Ninja 1.5.3 and later
- [x] Documentation site
- [x] Standalone binary for five platforms, attached to each release
- [x] 1.0 on npm, PyPI, Maven Central, Packagist and the Gradle Plugin Portal
- [ ] 1.1: app input rules on the Node and PHP servers, API Platform, Next.js, an axios client, example apps
- [ ] An `init` wizard that creates a workspace of services and frontends, in any repository layout, from pinned templates
- Later: a client conformance suite (1.2), a kit to write new targets, one shared core per language, then Bun, Deno, Workers, Kotlin, Swift, Dart, Go, .NET, Rust ([full list](docs/roadmap.md))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
