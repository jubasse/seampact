---
"@seampact/codegen-nestjs": minor
"@seampact/codegen-core": patch
---

The NestJS target now validates input in a seampact pipe, can let your global interceptors shape replies with the `reply: interceptor` option, refuses at boot a cache interceptor, a missing input param or a guard placed after seampact's, and takes a `logger` in `SeampactModule.forRoot(hooks, { logger })`.
