### 12. The OpenAPI mapping

The OpenAPI 3.1 document is emitted from the IR only (FR-11), and it is the interop surface every other tool reads, so what each IR member becomes in it is fixed here rather than left to the emitter. What OpenAPI states natively is written natively. What it cannot state is written as an `x-seampact-<name>` extension, kebab case, whose JSON Schema `@seampact/openapi` publishes (ADR 0009); the numeric refinements of ADR 0003 section 8 keep the JSON Schema keyword's spelling (`x-seampact-exclusiveMinimum`). A value source is written as in the grammar (`path.taskId`), an origin as its side-table key (`api#/surfaces/app/routes/...`, section 11), a core origin as `core#<pointer>`, which no source map resolves (section 11), a derivation by its id (ADR 0006 section 5). Consumer extension keys are written as `x-<prefix>-<key>` where they are declared (ADR 0002 section 12). The table is closed: an IR member without a row reaches no document, and a new row is a change to this ADR.

The table is what the emitter can write; the app config chooses, per document, what it does write (ADR 0011, [A40](../decisions.md#a40)): `extensions` (`all`, the default, `none`, or a list of extension names) keeps every `x-seampact-*` extension, none, or those listed, the native rows staying; `reasons: omit` drops every reason from the extensions it keeps, so a public document does not publish internal rationale; `inputSchemas: strict` writes, for each schema used as input, a second component named `<name>.input` with `additionalProperties: false` on every object that refuses unknown keys, except the top level of a body that carries proofs (see the `input` row), and points request bodies at it, so a plain OpenAPI reader (a mock server, a request validator, a client generator) sees the input as strict as the boundary serves it; `servers` writes OpenAPI's `servers`. These options select and shape rows; they never add an IR member, and with the defaults the document is the one this section describes.

Which documents exist is the user's choice, for every target alike ([A43](../decisions.md#a43)): per app, seampact's documents, the framework's own document completed by the `nativeDocs` artefact, both, or none (ADR 0011); by default an app with a server target writes seampact's documents, and an app with client targets only writes none. seampact's documents are always written from this table. A monorepo's root config may also ask for a merged document across the apps it lists: the documents of several apis, each mapped by this table, written as one. Each api appears once, taken from the apps that serve it (through their server targets) or document it (OpenAPI-only apps, with an `openapi` key and no target); only an app with client targets and no server target never feeds a merged document (ADR 0011). An element that two apis emit identically (a schema of the workspace's shared file, a shared security scheme, an error code with the same declaration) is written once. Two different elements under one name (an operation id, a component key of `components.schemas` or `components.securitySchemes`, a tag) are refused by `generate` and `check`, naming both apis, both elements and the fix: set a `prefix` for one of the apis in the merged document's entry, which writes `<prefix>.` before every operation id and component key of that api (`billing.listInvoices`, `billing.Invoice`, `billing.api.forbidden`). Two operations with the same method and path are always refused, since one document cannot say which service answers; the fix is a distinct contract path or separate documents. The options above apply to a merged document as to any other.

| IR | OpenAPI |
|---|---|
| `schemes` | `components.securitySchemes`: a cookie scheme is `apiKey` with `in: cookie`, a header scheme `apiKey` with `in: header`, a query scheme `apiKey` with `in: query`, a basic scheme `http` with `scheme: basic`, a bearer scheme `http` with `scheme: bearer` and its `bearerFormat`, or `oauth2` with its `flows`, or `openIdConnect` with its `openIdConnectUrl`; a signature scheme is `apiKey` with `in: header` and its `name`, plus `x-seampact-signature: { verify, format, algorithm, payload, encoding, toleranceMs, key }` for a template, or `{ verify: application, headers, key }` |
| `access`, identity | `security`: one Security Requirement Object per scheme the operation accepts (`schemes.read` on a safe operation, `schemes.write` otherwise). A cookie scheme with `csrf`, on a write, is one object holding the cookie scheme and its CSRF header scheme, since an object's schemes are all required. Plus `x-seampact-access: { identity }`. Credential and CSRF headers are written through the schemes, never as parameters |
| `access`, optional | the same list with `schemes.optionalRead` added on a read, plus `{}` (anonymous allowed), and `x-seampact-access: { identity, optionalAuth: <reason>, onRefused }` |
| `access`, public | `security: []` and `x-seampact-access: { public: <reason> }` |
| `access` of a signed identity | `security` with the signature scheme alone, `x-seampact-access: { identity }`, and `x-seampact-raw-body: true` on the request body |
| `csrf` exemption | `x-seampact-csrf: { exempt: <reason> }` |
| `principalRequires`, `bindings` | `x-seampact-principal-requires: [<field>]`, `x-seampact-bindings: [{ from, to }]` |
| `scopes` | `x-seampact-scopes: [{ scope, from }]` in resolution order; `from` is the source, or `resolver` |
| `requires` | `x-seampact-requires`: the items in order, `{ right, params, subject }` or `{ rule, params, bucket }`, with `entry` when written through a `requirements` entry |
| `fieldRights` | `x-seampact-restricted-to: [{ schema, pointer, right, params, direction, input }]` on the operation, empty and left out on a relay route |
| `filteredBy` | `x-seampact-filtered-by: <right>` |
| `paging` | the request roles as ordinary parameters (`maximum` from `maxLimit` unless `overLimit` is `clamp`, `default` from `defaultLimit`), the page as the response body schema the format and style give, the style's headers and `Link` as response headers, plus `x-seampact-paging: { style, position, roles: { <role>: <source> }, maxLimit, defaultLimit, overLimit, token, sortKeys: [{ key, right }] }`, or `{ none: true }` for an unpaged list |
| `concurrency` | the version as an ordinary parameter or body property, `ETag` on the responses carrying the item, plus `x-seampact-concurrency: { version, field }` |
| `idempotency` | the key header parameter and the replay response header, plus `x-seampact-idempotency: { header, replayHeader, lifetimeMs, required, enforce }`, or `{ exempt: <reason> }` |
| `owner` | `x-seampact-owner: caller` |
| `input` | the request body with its media type: the format's for JSON; `application/x-www-form-urlencoded` with an `encoding` entry per list or object field (`style: form`, `explode` as the conventions say); `multipart/form-data` with each file field as `type: string` with `contentMediaType` (the media list in the part's `encoding.contentType`) and `x-seampact-max-size`, and each JSON text field with `contentMediaType: application/json` and `contentSchema`. Component schemas carry no `additionalProperties: false`, since one schema serves both directions: strict input is the default every reader of a seampact document assumes, and an ignoring or keeping use writes `x-seampact-unknown-keys: { ignore: <reason> }` or `{ keep: <reason> }` on the request body. Body proofs (`input.proofs`, amendment 2026-10-13, irRevision 2) are properties of the request body schema, written `allOf: [<input schema>, { type: object, properties: <proofs>, required: <proof names> }]`, a proof-only input being that object alone, with no `ApiEmptyBody` reference (`ApiEmptyBody` is emitted as a component only when something other than a proof-only input references it); each proof property carries `x-seampact-derived-from`, and in a form or multipart body each proof gets the `encoding` entry its `wire` gives, as a field does. Under `inputSchemas: strict` the document stays strict and still accepts the proofs, which a top-level `additionalProperties: false` inside the `allOf` would refuse: the emitter (p3) picks the mechanism, for example `unevaluatedProperties: false` on the body wrapper, and tests it |
| `unknownQuery` | `x-seampact-unknown-query: { ignore: <reason> }` on an operation that ignores undeclared query keys |
| `responses` | the success responses, each body the format's shape written out around a reference to the payload schema, with the format's media type; a download as one content entry per media type, each `{ schema: { type: string, contentMediaType } }`, with `Content-Disposition`; a redirect as its status with the `Location` header and no content; a response's `docs` as the Response Object's `description` |
| `errors` | one response per error status, its `description` the list of its codes, its body the format's error body; each code is a component schema of that body for the code's params, named by the code (`api.forbidden`), with `x-seampact-nature`. Since a code now takes the component key alphabet (ADR 0002 section 4), a code equal to a schema id, a hoisted inline schema name or `<schema>.input` would share a key with that schema in `components.schemas`; the compiler refuses it (ADR 0006 section 3), so every document option emits distinct keys. Several codes on one status are a `oneOf`, with a `discriminator` on the member the format writes `$code` to when it is a top-level member (`code` under `bare`). The response carries `x-seampact-errors: [{ code, derivedFrom, origin }]`: each code's derivation, or the node that attached it |
| `examples` | the route examples, wrapped through the format and the paging style (ADR 0002 section 12), in the `examples` of the request body or of the response for their status or code |
| `cache` | the `Cache-Control` response header (its directives from the family) with `x-seampact-cache-control: { anonymous, identified }`, one value per caller kind, plus `ETag`, `If-None-Match` and the 304 when `etag` is set |
| identity headers | ordinary header parameters and response headers, each with `x-seampact-semantic` (`deadline`, `traceContext`, `actorSurface`, `versionToken`) |
| `budgetMs`, `upstream`, `maturity`, `degradable` | `x-seampact-budget-ms`, `x-seampact-upstream`, `x-seampact-maturity: { level, source, reason }`, `x-seampact-degradable` |
| `deprecated` | `deprecated: true`, the deprecation headers on the responses, and `x-seampact-deprecation: { sunset, successor }` |
| `internal` | left out of a document with `internal: exclude`; `x-seampact-internal: true` in the others |
| `relays` | `x-seampact-relays: { api, operationId }` |
| `format` | the media types above, `x-seampact-format: <format>` at the document root, and on an operation whose format differs |
| `api.kind`, `api.role`, `api.caller` | `x-seampact-api: { kind, role, caller }` at the document root; in a merged document (below), `x-seampact-apis: [{ name, kind, role, caller }]` at the root instead, and `x-seampact-source-api: <name>` on each operation |
| schema annotations | natively: a schema's `deprecated: true`, a property's `examples`, and a nested use's `docs` and `examples` on the items, keys or values schema it becomes; a union variant's `docs` as the `description` beside its `$ref` in the `oneOf` |
| schema marks | ADR 0003: `format: password` for `sensitive`, `{}` with `x-seampact-opaque: <reason>` for an opaque value, `x-seampact-discriminator` for a header-tagged union, `x-seampact-enum` and `x-seampact-enum-fallback` for an open output enum, the `x-seampact-*` refinements of `int64` and `decimal` |

```yaml
# emitted from the reference contract of ADR 0002 (excerpt)
paths:
  /v1/health:
    get:
      operationId: health
      security: []
      x-seampact-access: { public: "Probes call it before any user exists." }
  /v1/channels/{channelId}/tasks/{taskId}:
    patch:
      operationId: updateTask
      security:
        - { sessionCookie: [], csrfToken: [] }
        - { bearer: [] }
      x-seampact-access: { identity: user }
      x-seampact-scopes: [{ scope: channel, from: path.channelId }]
      x-seampact-requires: [{ right: tasks.update, subject: path.taskId }]
      x-seampact-concurrency: { version: body.expectedVersion, field: version }
      x-seampact-idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetimeMs: 86400000, required: true, enforce: boundary }
      responses:
        '403':
          description: 'api.csrf_invalid, api.forbidden'
          content:
            application/problem+json:
              schema:
                oneOf: [{ $ref: '#/components/schemas/api.csrf_invalid' }, { $ref: '#/components/schemas/api.forbidden' }]
                discriminator: { propertyName: code }
          x-seampact-errors:
            - { code: api.csrf_invalid, derivedFrom: csrf.cookieWrite }
            - { code: api.forbidden, derivedFrom: requirement.errors }
components:
  securitySchemes:
    stripeSignature:
      type: apiKey
      in: header
      name: Stripe-Signature
      x-seampact-signature: { verify: template, format: 't={ts},v1={sig}', algorithm: hmac-sha256, payload: '{ts}.{rawBody}', encoding: hex, toleranceMs: 300000, key: { value: stripe } }
```

A moved or added code therefore shows in the committed document's diff (ADR 0011 `checks.openapi`) on every operation it reaches, which is how a reviewer sees an attachment that an indentation slip moved up the tree (ADR 0002 section 8).
