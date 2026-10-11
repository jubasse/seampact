# seampact

Declare API semantics once. Derive framework-native boundaries from them.

seampact is a contract system for HTTP APIs. You describe an API in plain YAML files: its endpoints, schemas, errors, who may call each route and what each route requires. seampact compiles them into a canonical intermediate representation (IR), and everything else is derived from it: an OpenAPI 3.1 document, lint, a compatibility diff between two versions, and generated code for the frameworks you use.

**Status: design phase.** No package is published to npm, Maven Central or Packagist, and nothing can be installed yet. The design decisions are recorded in [`docs/adr/`](docs/adr/).

## What seampact generates, and what it leaves to you

seampact generates boundaries, not implementations.

- **Generated:** named types, validators, the route table, one handler interface per resource with exact input and output types, typed clients, derived errors and headers, and the access boundary a route needs.
- **Yours:** what a handler does, where data lives, how a credential is checked, how a right is decided and which tenant a request belongs to.

seampact is not a framework. Generated code uses your framework's own mechanisms (guards and exception filters in NestJS, `ProblemDetail` in Spring, Form Requests and API Resources in Laravel, normalizers in Symfony) and never replaces them.

Access is checked through three generated, typed hooks: authenticate, decide and resolve scope. You answer them with the library you already use (Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates, Symfony Voters, Spring Security) or with your own code. Your application refuses to start while a hook, a requirement or a route handler is missing.

No wire format is imposed. By default a response is the bare payload and an error is an RFC 9457 `application/problem+json` body. Envelopes, JSON-LD and Hydra, or your own house format come from opt-in convention packs.

## Package map

You install the core, then only the generators your project uses. Installing the CLI pulls no code generator.

### Core (npm)

| Package | What it does |
|---|---|
| `@seampact/cli` | the `seampact` command: `init`, `compile`, `check`, `lint`, `diff`, `generate`, `bundle` |
| `@seampact/compiler` | reads the YAML, reports errors with file, line and column, and produces the IR |
| `@seampact/spec` | the JSON Schemas of the YAML files and of the IR, with their TypeScript types |
| `@seampact/openapi` | writes one OpenAPI 3.1 document per api |
| `@seampact/lint` | lint rules over the IR, and the API to write your own |
| `@seampact/diff` | classifies changes between two versions as additive or breaking, per direction |
| `@seampact/codegen-core` | the API code generators are written against |

### Code generators for TypeScript (npm)

| You want | Install |
|---|---|
| types only | `@seampact/codegen-ts` |
| validators | `@seampact/codegen-zod`, `@seampact/codegen-yup` or `@seampact/codegen-class-validator` |
| a typed `fetch` client | `@seampact/codegen-fetch` |
| a server boundary | `@seampact/codegen-nestjs`, `@seampact/codegen-fastify`, `@seampact/codegen-express` or `@seampact/codegen-adonis`, plus `@seampact/hooks` |
| a frontend client | `@seampact/codegen-react`, `@seampact/codegen-angular` or `@seampact/codegen-vue` |

A server generator does not install a validator generator. You choose one and link the two in your project's `contracts.config.yaml`.

### Java and PHP

These run with no Node.js installed.

| Framework | Install |
|---|---|
| Spring Boot | the Gradle plugin `io.github.jubasse.seampact` or the Maven plugin `io.github.jubasse:seampact-maven-plugin` |
| Laravel | `seampact/laravel` as a development dependency, and `seampact/hooks` |
| Symfony | `seampact/symfony` as a development dependency, and `seampact/hooks` |
| API Platform | `seampact/api-platform` as a development dependency, and `seampact/hooks` |

### Optional packages

| Package | Use it when |
|---|---|
| `@seampact/pack-crud-rights` | you want a `<resource>.<op>` right on every CRUD route without declaring each one |
| `@seampact/pack-api-platform` | your API Platform api serves JSON-LD items, Hydra pages and Hydra errors |
| `@seampact/nestjs-casl` | your NestJS app decides rights with CASL |
| `seampact/laravel-spatie` | your Laravel app decides rights with spatie/laravel-permission |
| `@seampact/signed-webhooks`, and its Java and PHP equivalents | you receive Stripe-style or GitHub-style signed webhooks and want the signature checked for you |

## Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in `contracts.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.

## What seampact does not do

- Generate business logic, persistence, an authentication check or an authorization decision.
- Provide a server framework, or a TypeScript API to write contracts: YAML is the only way to declare one.
- Impose right names, roles, a permission model or a tenancy scheme.
- Model WebSocket, Server-Sent Events, gRPC or GraphQL. The IR leaves room for them; see [ADR 0014](docs/adr/0014-room-for-real-time-and-rpc.md).

## Design decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-toolchain.md) | toolchain |
| 0002 to 0007 | YAML grammar, schema language, IR shape, IR evolution, compiler passes, cross-language naming |
| [0008](docs/adr/0008-convention-packs-and-extensions.md) | convention packs and user extensions |
| [0009](docs/adr/0009-modular-packaging-and-target-composition.md) | packages and how generators compose |
| [0010](docs/adr/0010-native-generators.md) | Java and PHP generators and the standalone compiler |
| [0011](docs/adr/0011-distribution.md) | bundles, consumer config and installs |
| [0012](docs/adr/0012-access-hooks.md) | authenticate, decide and resolve-scope hooks |
| [0013](docs/adr/0013-signed-webhooks.md) | inbound signed webhooks |
| [0014](docs/adr/0014-room-for-real-time-and-rpc.md) | room for real-time and RPC |
| [0015](docs/adr/0015-codegen-determinism-and-conformance.md) | deterministic generation and the conformance suite |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
