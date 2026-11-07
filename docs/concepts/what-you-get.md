# What you get and what you write

seampact generates the boundary of your API: the code that checks what comes in and what goes out. You write what happens in between.

## What seampact generates

From one YAML contract:

| Output | What you get |
|---|---|
| Types | One TypeScript type per schema, per request and per reply. |
| Validators | zod, yup, class-validator, VineJS or Ajv schemas that check every input. |
| Server boundary | Routes for NestJS, Express, Fastify, AdonisJS, Hono, Spring Boot, Laravel, Symfony, FastAPI, Django REST Framework and Django Ninja. They check the input, call your access hooks and check each reply against the contract. |
| Built-in rules | Paging, rate limits, idempotency keys, ETags, CSRF, signed requests and field rights, declared in the contract and enforced at the boundary. You plug in the stores and decisions. |
| Errors | One error format, RFC 9457 `problem+json` by default, with typed error codes per route. |
| Clients | A typed `fetch` client, React hooks (TanStack Query, SWR or RTK Query), Vue composables, an Angular service and MSW mock handlers. |
| Docs | OpenAPI 3.1 documents, and your framework's own Swagger kept in line with the contract. |
| Editor support | Schemas that complete and check the contract's names as you type. |

Every guide lists the options of its target: [server guides](../backend/nestjs.md) and [client guides](../frontend/react.md).

## What you write

- The handlers: what each route does, and where your data lives.
- The access decisions: how a credential is checked and how a right is decided. You answer three generated hooks: authenticate, decide and resolve scope. Use the library you already have (Passport, Clerk, Laravel Gates, Spring Security) or your own code.
- Your app: its config, its secrets and its database. Generated code takes the backend URL and every setting as an argument.

The app refuses to start while an identity, a right, a rule or a scope has no hook, or while a route has no handler.

## What seampact does not do

- Business logic, persistence, authentication or authorization decisions.
- A server framework. Generated code uses your framework's own mechanisms and never replaces them.
- A TypeScript API to write contracts: YAML is the only way. An importer from an OpenAPI document is on the [roadmap](../roadmap.md).
- Right names, roles, a permission model, a wire format or a code style. Where seampact needs a value, it has a default you can rename. Paged lists, envelopes, JSON:API or HAL come from [convention packs](../features/convention-packs.md).
- WebSocket, Server-Sent Events, gRPC or GraphQL.

## The commands

| Command | What it does |
|---|---|
| `seampact init` | Starts a project: a config and an example contract. |
| `seampact generate` | Writes the code above into `__generated__`. |
| `seampact check` | Fails CI when generated files or documents differ from the contract. |
| `seampact diff` | Classifies the changes between two versions and tells which are breaking. |
| `seampact lint` | Reports contract mistakes before you generate. |
| `seampact explain notes.getNote` | Prints one route whole: params, rules, errors, and where each one comes from. |
| `seampact bundle` | Packs a contract so other repositories, Node or JVM, pin and reuse it. |

Next: the words used in these docs, in the [glossary](glossary.md).
