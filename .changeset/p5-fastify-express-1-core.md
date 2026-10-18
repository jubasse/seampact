---
"@seampact/codegen-core": minor
---

The Node server targets share one handler-map registration through `@seampact/codegen-core/node-server`, with `responses` and `bodyValidation` overridable per api and per operation, and register their routes most specific first; on NestJS, a malformed percent-encoding in a scoped path param now answers 400 instead of 500, an empty JSON body counts as no body, and a request routed to another operation than its raw path answers the path's 404.
