---
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-adonis": patch
---

Every Node server target now answers a `+json` media type on a JSON route with 415, a path under the api's base path that no route serves with the api's 404, HEAD on a GET path by running the GET operation without a body, and a cookie-only write without its CSRF header with the derived 403, while a path under a base path two apis of one app share stays the app's and Fastify refuses an instance created with `exposeHeadRoutes: false`.
