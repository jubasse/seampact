# Targets and links

Use this page to add targets and to link them. A target is one entry of `targets`: one package that writes one kind of code. A `link` tells it which other entry supplies a part it needs, such as the validators of a server. `link` names the other entry's `id`: `link: { validators: validators }` for a server, `link: { client: client }` for React or Vue.

## Add a target

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
```

- `id` names the entry and its folder.
- `use` is the target's package.
- `apis` lists the apis it generates (`api: notes` for one). An api name is the `name:` under `api:` in the contract, not the name of the source.
- `link` names the entries it builds on: `types: types`, `validators: validators`.
- `options` holds the target's own settings, for example `bodyValidation: true` on the NestJS server. Every option is in [Per-target options](reference.md#per-target-options).

## Which generators combine

Every generator handles every format and paging style your contract declares. What differs is the link. The CLI refuses a framework version known to be incompatible and warns on one it has not tested: see [Supported versions](../supported-versions.md).

| Generator | Produces | Links to |
|---|---|---|
| `codegen-ts` | types | nothing |
| `codegen-zod`, `codegen-yup` | validators (Standard Schema) | provides `validators` |
| `codegen-class-validator` | DTO classes with decorators | provides `validators` |
| `codegen-fetch` | typed client | provides `client` |
| `codegen-nestjs` | per-operation decorators, guard, handler wrapper and input decorators around your controllers | `validators`: zod, yup or class-validator |
| `codegen-fastify` | server boundary | `validators`: zod or yup, or Ajv without a link |
| `codegen-express` | server boundary for Express 4 and 5 | `validators`: zod or yup |
| `codegen-adonis` | server boundary for AdonisJS 6 and 7 | `validators`: zod or yup, or VineJS without a link |
| `codegen-hono` | server boundary for Hono 4 on Web-standard `Request` and `Response` | `validators`: zod or yup |
| `codegen-react` | React hooks: TanStack Query (`query: tanstack`), SWR (`query: swr`) or RTK Query (`query: rtk`), or no library (`query: fetch`) | `client`: fetch |
| `codegen-vue` | plain composables, or with `query: tanstack` or `query: pinia-colada` | `client`: fetch |
| `codegen-angular` | injectable services over `HttpClient`, and with `state: ngrx` or `state: ngrx-signals` typed actions and effects, or a Signal Store feature | nothing |
| `codegen-msw` | mock handlers for Mock Service Worker | `types` |
| Spring Boot plugin | composed annotations, interceptor and argument resolver around your controllers, with Bean Validation | nothing |
| `seampact/laravel` | routes, middleware and Form Requests around your controllers | nothing |
| `seampact/symfony` | route loader, attributes, a listener, a value resolver and Validator constraints around your controllers | nothing |
| `pypi:seampact-fastapi` | routes, a boundary middleware and dependencies around your handlers, with Pydantic models | nothing |
| `pypi:seampact-drf` | views, serializers, a boundary middleware and an exception handler around your handlers | nothing |
| `pypi:seampact-ninja` | a bind function that adds a Ninja router, with a boundary middleware and Pydantic models, around your handlers | nothing |

Guides: [React](../frontend/react.md), [Vue](../frontend/vue.md), [Angular](../frontend/angular.md), [NestJS](../backend/nestjs.md), [Spring Boot](../backend/spring-boot.md), [Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md), [FastAPI](../backend/fastapi.md). Their options are in [Per-target options](reference.md#per-target-options).

## Python targets

`use: pypi:<distribution>` names a Python target. The distribution must be installed in the environment that runs `seampact generate`, with its `generate` extra.

```yaml
targets:
  - id: notes
    out: notes
    use: pypi:seampact-fastapi
    api: notes
    options: { rules: seampact-consistent }
```

The Python targets take `rules`, `responses`, `frameworkEtag`, `catchAll`, and `bodyValidation` (FastAPI) or `views` (Ninja). Every option is in [Per-target options](reference.md#seampact-fastapi).

Versions: FastAPI 0.162 or later is named by minor (`allowUntested: [fastapi@0.163]`). Django, DRF and Ninja are named by major (`allowUntested: [django@7]`, `allowUntested: [django-ninja@2]`). The guides list what is tested: [FastAPI](../backend/fastapi.md#versions), [Django REST Framework](../backend/drf.md#versions), [Django Ninja](../backend/ninja.md#versions).

A `path` source and the OpenAPI documents need the compiler: install `seampact-ir[compiler]` or the binary, see [Install](../getting-started/01-install.md).

## Next

- Next: [Validators](validators.md).
- Every option: [Config reference](reference.md#per-target-options).
