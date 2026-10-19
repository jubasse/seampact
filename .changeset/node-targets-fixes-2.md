---
"@seampact/cli": minor
"@seampact/spec": minor
"@seampact/codegen-core": minor
"@seampact/codegen-express": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-hono": minor
"@seampact/codegen-nestjs": minor
"@seampact/codegen-adonis": minor
---

Node server apps now refuse to start on a route outside the contract unless the target entry's `frameworkRoutes` allow-lists it with a reason, or `artefacts.bootCheck.frameworkRoutes: false` switches the check off, and an Express or Hono app that never calls `checkFrameworkRoutes(app)` answers 500 with the problems logged.
