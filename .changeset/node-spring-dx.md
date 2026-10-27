---
"@seampact/server-runtime": patch
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
---

In development (`NODE_ENV=development` on Node, devtools on Spring Boot) an exception a handler throws reaches the framework's own error handler with a log line naming where it was thrown, NestJS apps set up `main.ts` and e2e tests with `configureApp(app)` and let a test module hold some controllers with `unboundOperations: "warn"`, and each server guide shows how to test its routes.
