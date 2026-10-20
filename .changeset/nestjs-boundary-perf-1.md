---
"@seampact/codegen-nestjs": minor
"@seampact/codegen-core": patch
---

The NestJS boundary now runs its checks in its guard, after every guard of your route wherever it is written, and writes the reply from a wrapper of your controller method instead of an interceptor, which removes NestJS's per-request interceptor cost and its native-memory growth on contract routes; your interceptors no longer see refusals of the access and input checks, a value a route interceptor maps is now ignored (the boot warns once per route carrying route or controller interceptors), and a method guard written above the operation's decorator now runs before the checks.
