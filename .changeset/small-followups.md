---
"@seampact/codegen-fetch": patch
"@seampact/codegen-nestjs": patch
"@seampact/cli": patch
---

The fetch client now generates a method for a list declared `paging: none`, which answers the bare array of its items.
NestJS apps write their Swagger document with one `createContractDocument` call, which always checks that no app class replaced a contract schema.
A validator library whose version cannot be read, or that is not installed, is now named a validator library in the error, not a framework package.
