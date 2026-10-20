---
"@seampact/cli": minor
"@seampact/spec": minor
"@seampact/compiler": minor
"@seampact/codegen-core": minor
"@seampact/codegen-express": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-hono": minor
"@seampact/codegen-nestjs": minor
"@seampact/codegen-adonis": minor
---

Switch off more built-in checks: `generate --force`, `warnings.ignore`, `artefacts.index: false`, `artefacts.bootCheck.hooks`, the `compression`, `frameworkEtag` and registration `logger` options of the Node server targets, and the `conventions.service.allowPublic` and `conventions.access.guestRule` contract settings, each with today's behaviour as the default.
