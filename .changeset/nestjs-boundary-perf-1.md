---
"@seampact/codegen-nestjs": minor
"@seampact/codegen-core": patch
---

The NestJS boundary now runs its checks in its guard, after every guard of your route, and writes the reply from a wrapper of your controller method instead of an interceptor, which removes NestJS's per-request interceptor cost and its native-memory growth on contract routes.
