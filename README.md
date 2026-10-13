# seampact

Declare API semantics once. Derive framework-native boundaries from them.

seampact is a contract system for HTTP APIs. You describe an API in plain YAML files: its endpoints, schemas, errors, who may call each route and what each route requires. seampact compiles them into a canonical intermediate representation (IR), and everything else is derived from it: an OpenAPI 3.1 document, lint, a compatibility diff between two versions, and generated code for the frameworks you use.

**Status: design phase.** No package is published to npm, Maven Central or Packagist, and nothing can be installed yet. The design decisions are recorded in [`docs/adr/`](docs/adr/).

## What seampact generates, and what it leaves to you

seampact generates boundaries, not implementations.

- **Generated:** named types, validators, the route table, one handler interface per resource (or tag, or operation) with exact input and output types, typed clients, derived errors and headers, and the utilities that place the access and validation checks around your controller: a decorator per operation in NestJS, a composed annotation in Spring, a FormRequest and middleware in Laravel, an attribute, a listener and a value resolver in Symfony, a listener and a decorated provider in API Platform.
- **Yours:** the controllers, which implement the generated interfaces, what a handler does, where data lives, how a credential is checked, how a right is decided and which tenant a request belongs to. seampact never generates a controller, and everything it generates goes to one directory, `__generated__` by default.

seampact is not a framework. Generated code uses your framework's own mechanisms (guards, interceptors and exception filters in NestJS, interceptors, argument resolvers and `ProblemDetail` in Spring, Form Requests and API Resources in Laravel, listeners and normalizers in Symfony) and never replaces them. Which OpenAPI documents you get is your choice, per app: seampact's document (the default for an app that serves routes; a frontend with client targets only writes none unless it asks), your framework's own document (`@nestjs/swagger`, springdoc, API Platform's) completed by the opt-in `nativeDocs` artefact so it agrees with the contract, both, or none. seampact never turns your framework's own generation off unless you ask, and a monorepo can also write one document across its apps.

Access is checked through three generated, typed hooks: authenticate, decide and resolve scope. You answer them with the library you already use (Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates, Symfony Voters, Spring Security) or with your own code. Your application refuses to start while an identity, right, rule or scope has no hook, or a route has no handler. Or keep your framework's own access rules: turn the access hooks off and seampact exports each route's access for them to enforce.

seampact imposes nothing: not a wire format, a page shape, error codes, header names, a versioning scheme, a permission model, a validator, a client library or a code style. Where it needs a value to work, it has a default you can rename; everything else comes from your contract or from opt-in packs. What it does demand is explicitness: every route states who may call it, and every exception states its reason.

By default a response is the bare payload and an error is an RFC 9457 `application/problem+json` body, with default error codes you can rename or replace with your own (`TASK_NOT_FOUND` works). Paged lists declare their own parameter names and page shape, or take them from a pack. Bodies are JSON, forms or multipart uploads, responses may be file downloads or redirects, and a value a third party shapes freely can be declared opaque. Envelopes, JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring `Page`, or your own house format come from opt-in convention packs.

## Package map

You install the core, then only the generators your project uses. Installing the CLI pulls no code generator.

### Core (npm)

| Package | What it does |
|---|---|
| `@seampact/cli` | the `seampact` command: `init`, `compile`, `check`, `lint`, `diff`, `generate`, `bundle`, and `explain`, which prints one operation whole with where each part comes from |
| `@seampact/compiler` | reads the YAML, reports errors with file, line and column, and produces the IR |
| `@seampact/spec` | the JSON Schemas of the YAML files, one per file and fragment kind for your editor, and of the IR, with their TypeScript types |
| `@seampact/openapi` | writes the OpenAPI 3.1 documents your configs ask for (one per api or declared document, or one merged across a monorepo's apps), with what OpenAPI cannot say as published `x-seampact-*` extensions |
| `@seampact/lint` | lint rules over the IR, and the API to write your own |
| `@seampact/diff` | classifies changes between two versions as additive or breaking, per direction |
| `@seampact/codegen-core` | the API code generators are written against |

### Code generators for TypeScript (npm)

| You want | Install |
|---|---|
| types only | `@seampact/codegen-ts` |
| validators | `@seampact/codegen-zod`, `@seampact/codegen-yup` or `@seampact/codegen-class-validator` |
| a typed `fetch` client | `@seampact/codegen-fetch` |
| a server boundary | `@seampact/codegen-nestjs`, `@seampact/codegen-fastify`, `@seampact/codegen-express` or `@seampact/codegen-adonis`, plus `@seampact/hooks` unless the target vendors its types |
| a frontend client | `@seampact/codegen-react`, `@seampact/codegen-angular` or `@seampact/codegen-vue` |

A server generator does not install a validator generator. You choose one and link the two in your app's `seampact.config.yaml`, where you also turn each generated artefact on or off. The CLI checks the combination against a published compatibility matrix and, when it does not work, names the ones that do.

Each app of a repository (frontend, backend, service) has its own `seampact.config.yaml`; a monorepo can add a root one that lists the apps and shares contract sources. An app that only needs the OpenAPI document installs no generator at all, and an app that wants no seampact document says so.

### Java and PHP

These run with no Node.js installed. The standalone compiler binary runs `init`, `compile`, `check`, `lint` (core rules), `diff`, `explain` and `bundle`, so a Java or PHP team can own a contract repository without Node.js. The Gradle and Maven plugins read `seampact.config.yaml` or the same keys in their own DSL.

| Framework | Install |
|---|---|
| Spring Boot | the Gradle plugin `io.github.jubasse.seampact` or the Maven plugin `io.github.jubasse:seampact-maven-plugin`, and `io.github.jubasse:seampact-hooks` unless the target vendors its types |
| Laravel | `seampact/laravel` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| Symfony | `seampact/symfony` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| API Platform | `seampact/api-platform` as a development dependency, and `seampact/hooks` unless the target vendors its types |

### Which generators combine

Every generator renders the default format and every format and paging style your contract or a pack declares, including your own page shapes: formats are data in the contract, not code in a generator. What differs is how each one plugs into its framework and what it links to. Supported framework versions are listed per release in `@seampact/spec`'s `compatibility/matrix.json`, and the CLI refuses a combination the matrix records as incompatible, and warns on a framework version it has not tested.

| Generator | Produces | Links to | Formats mapped onto |
|---|---|---|---|
| `codegen-ts` | types | nothing | not applicable: payload types only |
| `codegen-zod`, `codegen-yup` | validators (Standard Schema) | provides `validators` | not applicable: payloads only |
| `codegen-class-validator` | DTO classes with decorators | provides `validators` | not applicable: payloads only |
| `codegen-fetch` | typed client | provides `client` | the client's response readers |
| `codegen-nestjs` | per-operation decorators, guard, interceptor and input decorators around your controllers | `validators`: zod, yup or class-validator | exception filters and interceptors |
| `codegen-fastify` | server boundary | `validators`: zod or yup, or Ajv without a link | route hooks |
| `codegen-express` | server boundary | `validators`: zod or yup | middleware |
| `codegen-adonis` | server boundary with VineJS validators | nothing | middleware and exception handler |
| `codegen-react` | TanStack Query hooks | `client`: fetch | through the fetch client |
| `codegen-vue` | composables | `client`: fetch | through the fetch client |
| `codegen-angular` | injectable services over `HttpClient` | nothing | its own response readers |
| Spring Boot plugin | composed annotations, interceptor and argument resolver around your controllers, with Bean Validation | nothing | `ProblemDetail`, Spring Data `Page` |
| `seampact/laravel` | routes, middleware and Form Requests around your controllers | nothing | API Resources and paginators |
| `seampact/symfony` | route loader, attributes, a listener, a value resolver and Validator constraints around your controllers | nothing | normalizers |
| `seampact/api-platform` | resource metadata, DTOs, a listener and a decorated provider around your providers and processors | nothing | API Platform's serializer, JSON-LD and Hydra |

In an app config, a link names the other entry's `id`: `link: { validators: validators }` for a server, `link: { client: client }` for React or Vue.

### Optional packages

| Package | Use it when |
|---|---|
| `@seampact/pack-crud-rights` | you want a `<resource>.<op>` right on every route the `ops` shorthand generates, `batch` included, without declaring each one |
| `@seampact/pack-api-platform` | your API Platform api serves JSON-LD items, Hydra pages and Hydra errors |
| `@seampact/pack-laravel` | your api serves Laravel API Resources and paginators |
| `@seampact/pack-spring` | your api serves Spring Data `Page` bodies |
| `@seampact/pack-jsonapi` | your api speaks JSON:API |
| `@seampact/pack-hal` | your api serves HAL |
| `@seampact/nestjs-casl` | your NestJS app decides rights with CASL |
| `seampact/laravel-spatie` | your Laravel app decides rights with spatie/laravel-permission |
| `@seampact/signed-webhooks`, and its Java and PHP equivalents | you receive Stripe-style or GitHub-style signed webhooks and want the signature checked for you; other senders (Standard Webhooks, Slack) are verified by your own hook with their own library |
| `@seampact/http-suite` | you write your own server target and want to prove it against the shared HTTP suite |

## Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in its `seampact.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.

## What seampact does not do

- Generate business logic, persistence, an authentication check or an authorization decision.
- Provide a server framework, or a TypeScript API to write contracts: YAML is the only way to declare one. An importer from an existing OpenAPI document is planned for v3.
- Impose right names, roles, a permission model, a tenancy scheme, a wire format or a code style.
- Model WebSocket, Server-Sent Events, gRPC or GraphQL. The IR leaves room for them; see [ADR 0014](docs/adr/0014-room-for-real-time-and-rpc.md).

## Design decisions

The ADRs cite product decisions by id (`A<n>`); [`docs/decisions.md`](docs/decisions.md) states each one.

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-toolchain.md) | toolchain |
| [0002](docs/adr/0002-grammar.md) | YAML grammar |
| [0003](docs/adr/0003-schema-language.md) | schema language |
| [0004](docs/adr/0004-ir-shape.md) | IR shape |
| [0005](docs/adr/0005-ir-evolution.md) | IR evolution |
| [0006](docs/adr/0006-compiler-pass-pipeline.md) | compiler passes |
| [0007](docs/adr/0007-cross-language-naming.md) | cross-language naming |
| [0008](docs/adr/0008-convention-packs-and-extensions.md) | convention packs and user extensions |
| [0009](docs/adr/0009-modular-packaging-and-target-composition.md) | packages and how generators compose |
| [0010](docs/adr/0010-native-generators.md) | Java and PHP generators and the standalone compiler |
| [0011](docs/adr/0011-distribution.md) | bundles, the app config and installs |
| [0012](docs/adr/0012-access-hooks.md) | authenticate, decide and resolve-scope hooks |
| [0013](docs/adr/0013-signed-webhooks.md) | inbound signed webhooks |
| [0014](docs/adr/0014-room-for-real-time-and-rpc.md) | room for real-time and RPC |
| [0015](docs/adr/0015-codegen-determinism-and-conformance.md) | deterministic generation and the conformance suite |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
