---
"@seampact/codegen-nestjs": minor
"@seampact/codegen-core": minor
---

Add `@seampact/codegen-nestjs`, which generates the NestJS boundary around your controllers: a decorator per operation, the access guard, the validation and response interceptor, an input decorator, the error filter and a boot check, validating with zod; `@seampact/codegen-core` now provides the shared request checks every Node server target generates, and a target can return warnings naming the contract forms your handler must enforce.
