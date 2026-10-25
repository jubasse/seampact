# Roadmap after 1.0

In this order, each step reusing what the one before built:

1. Client conformance suite: one black-box test suite every client target passes (fetch, React, Vue, Angular, mobile), the client-side twin of the server HTTP suite.
2. Target authoring kit: a guide to writing a target, a documented `defineTarget`, and a command that scaffolds a new target with its compatibility row and its conformance run, so new frameworks, validators and query libraries plug in the same way, including from the community.
3. One shared core per language: each new language starts with a core (reading the contract, the boundary steps, naming) that its frameworks reuse, as the Node runtime serves five servers and the Spring Boot core will serve Quarkus and Micronaut.
4. Web-standard server targets on the Hono adapter: Next.js route handlers, Bun, Deno, Cloudflare Workers.
5. Mobile clients: Kotlin first (Android, Ktor client, Kotlin Multiplatform), then Swift, then Dart for Flutter.
6. Python: FastAPI, then Django REST Framework or Django Ninja; Flask on demand.
7. More JVM frameworks on the Spring Boot core: Quarkus, Micronaut, Ktor.
8. Go: `net/http` handlers, then Gin, Chi and Echo.
9. .NET: ASP.NET Core.
10. Rust: Axum and Actix Web.
11. Front extras: an axios client variant and Angular reactive-form validators.
12. Much later: Ruby on Rails, Svelte and SvelteKit, Solid. Until then Rails apps read the OpenAPI document, and Svelte and Solid apps use the TypeScript client and zod.
13. Example apps, one per stack pairing (for example NestJS with React, Spring Boot with Vue), each from one contract and kept green by CI.
14. Project wizard and starter templates: `seampact init` asks which apps you want (several services and frontends, as in a microservice setup), then for each one its framework, validator, client and query library, and which services' apis a frontend calls. It creates the workspace (root config, one config per app, contracts) from pinned templates. Any layout works: one repository, one per app, or a mix. For each contract it asks whether it lives here or comes from a published bundle, and for each app its stack. The same choices work as flags for CI, and `seampact init --app <dir>` adds one app to an existing workspace.
