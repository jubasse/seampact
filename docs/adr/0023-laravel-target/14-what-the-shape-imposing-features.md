### What the shape-imposing features turn off with

The target imposes no wire shape ([A36](../../decisions.md#a36)). Each feature that adds behaviour beyond the contract has a switch:

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| Laravel's own value rules | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |
| API Resources and paginators | never by default | the contract's `pack:laravel` format and paging styles |

The error format is the api's declared format; `pack:laravel` keeps errors bare problem+json (ADR 0008). Laravel ships no OpenAPI generator, so the target declares no `nativeDocs` artefact and reads no `frameworkDocs`: the app config refuses both keys by name (`config.artefacts.unknown`).
