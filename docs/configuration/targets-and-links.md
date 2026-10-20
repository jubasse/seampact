# Targets and links

A target generates one kind of code. A link says which other target it builds on.

## Add a target

Each target generates one kind of code.

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
```

- `id` names the entry and its folder.
- `use` is the target's package.
- `apis` lists the contracts it covers (`api: notes` for one).
- `link` names the entries it builds on: `types: types`, `validators: validators`.
- `options` holds the target's own settings, for example `bodyValidation: true` on the NestJS server.

## Which generators combine

Every generator renders the default format and every format and paging style your contract or a pack declares, including your own page shapes: formats are data in the contract, not code in a generator. What differs is how each one plugs into its framework and what it links to. Supported framework versions are listed per release in `@seampact/spec`'s `compatibility/matrix.json`, and the CLI refuses a combination the matrix records as incompatible, and warns on a framework version it has not tested.

| Generator | Produces | Links to | Formats mapped onto |
|---|---|---|---|
| `codegen-ts` | types | nothing | not applicable: payload types only |
| `codegen-zod`, `codegen-yup` | validators (Standard Schema) | provides `validators` | not applicable: payloads only |
| `codegen-class-validator` | DTO classes with decorators | provides `validators` | not applicable: payloads only |
| `codegen-fetch` | typed client | provides `client` | the client's response readers |
| `codegen-nestjs` | per-operation decorators, guard, handler wrapper and input decorators around your controllers | `validators`: zod, yup or class-validator | exception filters and the handler wrapper |
| `codegen-fastify` | server boundary | `validators`: zod or yup, or Ajv without a link | route hooks |
| `codegen-express` | server boundary for Express 4 and 5 | `validators`: zod or yup | middleware |
| `codegen-adonis` | server boundary for AdonisJS 6 and 7 | `validators`: zod or yup (VineJS planned) | middleware and exception handler |
| `codegen-hono` | server boundary for Hono 4 on Web-standard `Request` and `Response` | `validators`: zod or yup | middleware |
| `codegen-react` (planned) | hooks for TanStack Query, RTK Query or SWR, chosen with the `query` option | `client`: fetch | through the fetch client |
| `codegen-vue` (planned) | plain composables, or with `query: tanstack` or `query: pinia-colada` | `client`: fetch | through the fetch client |
| `codegen-angular` (planned) | injectable services over `HttpClient`, and with `state: ngrx` or `state: ngrx-signals` typed actions and effects, or a Signal Store feature | nothing | its own response readers |
| `codegen-msw` (planned) | mock handlers for Mock Service Worker | `types` | not applicable: mocks the contract's own responses |
| Spring Boot plugin | composed annotations, interceptor and argument resolver around your controllers, with Bean Validation | nothing | `ProblemDetail`, Spring Data `Page` |
| `seampact/laravel` | routes, middleware and Form Requests around your controllers | nothing | API Resources and paginators |
| `seampact/symfony` | route loader, attributes, a listener, a value resolver and Validator constraints around your controllers | nothing | normalizers |
| `seampact/api-platform` | resource metadata, DTOs, a listener and a decorated provider around your providers and processors | nothing | API Platform's serializer, JSON-LD and Hydra |

In an app config, a link names the other entry's `id`: `link: { validators: validators }` for a server, `link: { client: client }` for React or Vue.
