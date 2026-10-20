---
"@seampact/codegen-fetch": patch
"@seampact/codegen-nestjs": patch
---

The fetch client now generates a method for a list declared `paging: none`, which answers the bare array of its items.
NestJS apps write their Swagger document with one `createContractDocument` call, which always checks that no app class replaced a contract schema.
