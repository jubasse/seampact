### What the shape-imposing features turn off with

The target imposes no wire shape ([A36](../../decisions.md#a36)):

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| Pydantic's own value rules | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |
| contract routes in FastAPI's document | off | `artefacts.nativeDocs: true` |
