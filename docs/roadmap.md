# Roadmap after 1.0

In this order, each step reusing what the one before built:

1. Web-standard server targets on the Hono adapter: Next.js route handlers, Bun, Deno, Cloudflare Workers.
2. Mobile clients: Kotlin first (Android, Ktor client, Kotlin Multiplatform), then Swift, then Dart for Flutter.
3. Python: FastAPI, then Django REST Framework or Django Ninja; Flask on demand.
4. More JVM frameworks on the Spring Boot core: Quarkus, Micronaut, Ktor.
5. Go: `net/http` handlers, then Gin, Chi and Echo.
6. .NET: ASP.NET Core.
7. Rust: Axum and Actix Web.
8. Front extras: an axios client variant and Angular reactive-form validators.
9. Much later: Ruby on Rails, Svelte and SvelteKit, Solid. Until then Rails apps read the OpenAPI document, and Svelte and Solid apps use the TypeScript client and zod.
10. Example apps, one per stack pairing (for example NestJS with React, Spring Boot with Vue), each from one contract and kept green by CI.
11. Project wizard and starter templates: `seampact init` asks which apps you want (several services and frontends, as in a microservice setup), then for each one its framework, validator, client and query library, and which services' apis a frontend calls. It creates the workspace (root config, one config per app, contracts) from pinned templates. Any layout works: one repository, one per app, or a mix. For each contract it asks whether it lives here or comes from a published bundle, and for each app its stack. The same choices work as flags for CI, and `seampact init --app <dir>` adds one app to an existing workspace.
