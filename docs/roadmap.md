# Roadmap after 1.0

## 1.1 (delivered)

- App input rules: add your own rules on top of the generated validation, written in your validator library, on the Node and PHP servers ([ADR 0028](adr/0028-app-input-rules.md)). Python, Spring Boot and API Platform follow in 1.2.0.
- API Platform on Symfony.
- Next.js route handlers.
- An axios client.
- Example apps: NestJS with React, Laravel with Vue, and a full-stack Next.js app.

## 1.2.0

- The 1.1 deferrals: app input rules on Python, Spring Boot and API Platform, the Laravel flavour of API Platform, the native 422 of the Laravel pack, a Spring Boot with Angular example, and one types output for a Next.js full-stack app.
- Client conformance suite: one black-box test suite every client target passes (fetch, axios, React, Vue, Angular, mobile), the client-side twin of the server HTTP suite.

## After 1.2.0

In this order, each step reusing what the one before built:

1. Target authoring kit: a guide to writing a target, a documented `defineTarget`, and a command that scaffolds a new target with its compatibility row and its conformance run, so new frameworks, validators and query libraries plug in the same way, including from the community.
2. One shared core per language: each new language starts with a core (reading the contract, the boundary steps, naming) that its frameworks reuse, as the Node runtime serves five servers and the Spring Boot core will serve Quarkus and Micronaut.
3. More web-standard server targets on the Hono adapter: Bun, Deno, Cloudflare Workers.
4. Mobile clients: Kotlin first (Android, Ktor client, Kotlin Multiplatform), then Swift, then Dart for Flutter.
5. Python, beyond the FastAPI, Django REST Framework and Django Ninja targets of 1.0: Flask and Litestar with msgspec, each on demand. marshmallow is not planned.
6. More JVM frameworks on the Spring Boot core: Quarkus, Micronaut, Ktor.
7. Go: `net/http` handlers, then Gin, Chi and Echo.
8. .NET: ASP.NET Core.
9. Rust: Axum and Actix Web.
10. Front extras: Angular reactive-form validators.
11. Much later: Ruby on Rails, Svelte and SvelteKit, Solid. Until then Rails apps read the OpenAPI document, and Svelte and Solid apps use the TypeScript client and zod.
12. More example apps, one per stack pairing (for example Spring Boot with Vue), each from one contract and kept green by CI.
13. Project wizard and starter templates: `seampact init` asks which apps you want (several services and frontends, as in a microservice setup), then for each one its framework, validator, client and query library, and which services' apis a frontend calls. It creates the workspace (root config, one config per app, contracts) from pinned templates. Any layout works: one repository, one per app, or a mix. For each contract it asks whether it lives here or comes from a published bundle, and for each app its stack. The same choices work as flags for CI, and `seampact init --app <dir>` adds one app to an existing workspace.
