### 5. The api file

```yaml
# tasks/api.yaml (excerpt)
api:
  name: tasks
  version: 1
  kind: product
  maturity: provisional
  summary: Tasks shared inside channels.
  description: { $file: ./docs/api.md }
  compat: { policy: additive-only }
  documents:
    public: { internal: exclude }
    full: {}
extends: ./base.yaml
```

| Key | Meaning |
|---|---|
| `name` | the api name, unique in the workspace |
| `version` | an integer, from which the path version derives (section 6); or a quoted string (`'2024-06-20'`, a date-versioned api) when every surface's path version is `none` |
| `kind` | `product` (default: an api for end users and their clients) or `service` (an internal api with a caller identity, below) |
| `role` | `gateway`: every route derives 502, 503 and 504 from the `upstreamUnavailable`, `serviceUnavailable` and `upstreamTimeout` roles (FR-34) |
| `caller` | service apis only: `{ identity, right }`; see below |
| `maturity` | `experimental`, `provisional` or `stable`; the default maturity of every operation |
| `compat` | `{ policy: additive-only }` or `{ policy: none }`; gates releases and `maturity: stable` (FR-13, SCN-019, SCN-050) |
| `documents` | the OpenAPI documents to emit; see below |
| `summary`, `description` | docs; `description` may be a `$file` |

A service api (FR-8) states `caller: { identity: service, right: callerService }`. Every route of it runs under that identity, which its surfaces need not repeat and no node may change; a public or optional-auth route is a compile error; a route whose `requires` does not include `caller.right` is a compile error (SCN-014, SCN-045). The names are the contract's own (A20): the core knows only that this api has a caller identity and a caller right.

`documents` declares named OpenAPI documents. Each entry takes `surfaces` (the surfaces it covers, default all) and `internal` (`include`, the default, or `exclude`). An api with no `documents` emits one document holding every route (SCN-044). `documents` says what a document of this api may hold; whether any is written is the app's choice, for every target alike ([A43](../decisions.md#a43)): seampact's documents (the default for an app with a server target; an app with client targets only writes none unless it asks), the framework's own document completed by the `nativeDocs` artefact, both, or none, and a monorepo's root config may also write one document merged across its apps (ADR 0011). Where each document is written, and how it is rendered (which `x-seampact-*` extensions it carries, whether reasons appear, strict input schemas, `servers`), is app configuration (ADR 0011); what each IR member becomes in it, natively or as an `x-seampact-*` extension, is ADR 0004 section 12.
