---
"@seampact/codegen-core": minor
"@seampact/codegen-zod": patch
"@seampact/cli": patch
---

The Node server targets now share one options parser and one Express body handling through `@seampact/codegen-core/node-server`, the generated zod validators name the contract rule of each custom check in its `params.rule`, and `seampact generate` names a refusal's or warning's operation and member once.
