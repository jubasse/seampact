---
"@seampact/cli": minor
"@seampact/spec": minor
"@seampact/codegen-core": minor
"@seampact/codegen-adonis": minor
"@seampact/codegen-express": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-hono": minor
"@seampact/codegen-nestjs": minor
---

A server target entry now takes `mount` to serve its api under a path prefix on every server, and the boot check reads only the app routes that reach the api's paths unless `artefacts.bootCheck.frameworkRoutes` is `strict`.
