# Roadmap after 1.0

## 1.1 (delivered)

- App input rules: add your own rules on top of the generated validation, written in your validator library, on the Node and PHP servers ([ADR 0028](adr/0028-app-input-rules.md)). Python, Spring Boot and API Platform follow in 2.0.0.
- API Platform on Symfony.
- Next.js route handlers.
- An axios client.
- Example apps: NestJS with React, Laravel with Vue, and a full-stack Next.js app.

## 2.0.0: the core in Rust

seampact's compiler and generators move from TypeScript to Rust, and the features first planned for 1.2.0 land on the new core, so nothing is written twice.

- One standalone binary of about 11-14 MB per platform, against about 125 MB today (estimate). No stack needs Node.js to compile, generate or check anymore, TypeScript targets included.
- Every first-party generator runs in the binary. The runtime packages your app imports stay separate, opt-in packages, as today. Most npm packages of the compiler side (`compiler`, `openapi`, `diff`, `lint`, `codegen-core`, the `codegen-*` targets) are retired; `@seampact/cli` installs the launcher and one platform package.
- The contract, the IR and the config stay the same. The generated code keeps its behaviour; its formatting changes once, to one airy style shared by every language.
- Custom targets: an external generator protocol (the IR in, files out), in any language.
- `seampact test`: the server HTTP suite in the binary, so JVM, PHP and Python apps run it without Node.js.
- App input rules on Python (FastAPI, Django REST Framework, Django Ninja), Spring Boot and API Platform.
- Rights adapters: CASL for NestJS, spatie/laravel-permission for Laravel.
- JSON:API on Laravel 13's own JSON:API resources, and the native 422 of the Laravel pack.
- Client conformance suite: one black-box test suite every client target passes (fetch, axios, React, Vue, Angular, mobile), the client-side twin of the server HTTP suite.
- One types output for a Next.js full-stack app.
- A Spring Boot with Angular example.
- The fixes planned for 1.1.1: dotted wire names in Laravel's validation error keys, gzip bodies with several members on Python and Spring Boot, one path base for every diagnostic.
- Tests: the compiler and generator tests move to Rust with the code they test, written as Rust tests rather than copies; the same fixtures, goldens and spec vectors stay the shared corpus, and during the port every output is compared with the TypeScript compiler's. Runtime tests and the consumer projects stay in each language, since they prove the generated code in a real app.
- CI rebuilt around the binary: Rust, JVM, PHP and Python jobs no longer install Node.js, TypeScript jobs install only what they test, and the repository tooling moves to Rust too. The release publishes the binary per platform, a small npm launcher and lighter Python, Maven and Composer packages, with faster CI and releases.

## After 2.0.0

- A Flask target.
- ASP.NET Core, the first target on a .NET runtime, published on NuGet.
- API Platform's Laravel flavour: later, on demand. Its usage is small beside Laravel's own resources (`api-platform/laravel` has about 0.14% of `laravel/framework`'s downloads).

## Later

In this order, each step reusing what the one before built:

1. Target authoring kit: a guide to writing a target, WASM plugins with Rust and TypeScript SDKs over the 2.0.0 generator protocol, and a command that scaffolds a new target with its compatibility row and its conformance run, so new frameworks, validators and query libraries plug in the same way, including from the community.
2. One shared runtime per language: each new language starts with a runtime (the boundary steps, naming) that its frameworks reuse, as the Node runtime serves five servers and the Spring Boot runtime will serve Quarkus and Micronaut; its generators live in the binary.
3. More web-standard server targets on the Hono adapter: Bun, Deno, Cloudflare Workers.
4. Mobile clients: Kotlin first (Android, Ktor client, Kotlin Multiplatform), then Swift, then Dart for Flutter.
5. Python, beyond FastAPI, Django REST Framework, Django Ninja and Flask: Litestar with msgspec, on demand. marshmallow is not planned.
6. More JVM frameworks on the Spring Boot core: Quarkus, Micronaut, Ktor.
7. Rust: Axum, then Actix Web.
8. Go: `net/http` handlers, then Gin, Chi and Echo.
9. More .NET frameworks on the ASP.NET Core core, on demand.
10. Front extras: Angular reactive-form validators.
11. Much later: Ruby on Rails, Svelte and SvelteKit, Solid. Until then Rails apps read the OpenAPI document, and Svelte and Solid apps use the TypeScript client and zod.
12. More example apps, one per stack pairing (for example Spring Boot with Vue), each from one contract and kept green by CI.
13. Project wizard and starter templates: `seampact init` asks which apps you want (several services and frontends, as in a microservice setup), then for each one its framework, validator, client and query library, and which services' apis a frontend calls. It creates the workspace (root config, one config per app, contracts) from pinned templates. Any layout works: one repository, one per app, or a mix. For each contract it asks whether it lives here or comes from a published bundle, and for each app its stack. The same choices work as flags for CI, and `seampact init --app <dir>` adds one app to an existing workspace.
