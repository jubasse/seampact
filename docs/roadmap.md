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
