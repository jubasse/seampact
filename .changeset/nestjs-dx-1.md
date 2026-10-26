---
"@seampact/codegen-nestjs": patch
---

NestJS hooks can be built from injected providers with `SeampactModule.forRootAsync` and replaced in tests through `SEAMPACT_HOOKS`, a thrown `NotFoundException` or typed `ContractException` answers the declared contract code, an interceptor that skips the handler answers a logged 500 instead of hanging, and a path prefix, `@HttpCode` or `@Header` on a contract route stops the boot with its fix.
