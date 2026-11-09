### What the shape-imposing features turn off with

The target imposes no wire shape (A36). Each feature that adds behaviour beyond the contract has a switch:

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| the Spring Security beans | from the classpath | `springSecurity: false` |
| permitting public and optional routes in Spring Security | off | `springSecurity: { matchers: true }` |
| springdoc annotations on contract routes (`@Operation` with the id, docs and successes; the `input` parameter hidden) | off | `artefacts.nativeDocs: true` |
| springdoc's own document | kept | `frameworkDocs: off`, written as `springdoc.api-docs.enabled=false` in a generated `seampact-<api>.properties` on the resources root the plugins add, which the app loads with `spring.config.import` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |
| `Pageable` and `Page` | never by default | the contract's `springPage` paging style |

The error format is the api's declared format; `ProblemDetail` is used only when the api declares `application/problem+json`.
