### 9. Access, identities, rights, rules, scopes

#### Access on a node

- `identity: <name>`: the route requires that identity. A surface usually sets it once.
- `access: { public: "<reason>" }`: no authentication; the principal is null.
- `access: { optionalAuth: "<reason>" }`: an anonymous caller or the nearest `identity`. A presented credential that the authenticate hook refuses is treated as anonymous by default, never answered 401 (A33), which is what a sign-out with an expired session needs. `onRefused: reject` beside it answers 401 instead, as GitHub does for a bad token on a public endpoint: `access: { optionalAuth: "<reason>", onRefused: reject }`. `onRefused` is `anonymous` (the default) or `reject`, and is refused without `optionalAuth` (A40).
- `csrf: { exempt: "<reason>" }`: no CSRF check on this route's cookie writes.

`identity` and `access` are inherited separately, the nearest winning for each (section 8). A node that sets `identity` without `access` makes the identity required again below it; `optionalAuth` uses the nearest `identity`, and both may be set on one node. A route that resolves to neither an identity nor a public access is a compile error that names both fixes (FR-4, SCN-007). A public child under an identified parent still needs its reason (SCN-035).

#### Security schemes

```yaml
# shared/base.yaml (excerpt)
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  deviceToken: { kind: header, name: X-Device-Token }
  internalToken: { kind: bearer, bearerFormat: jwt }
```

`kind` is `cookie`, `header` (an API key in a header), `query` (an API key in a query parameter, as some map and webhook apis still take), `bearer` (HTTP bearer), `basic` (HTTP Basic) or `signature` (A5). `name` is the cookie, header or query parameter name; `bearer` and `basic` take none. A `query` scheme's parameter is never a declared query field and never an unknown key. `bearerFormat` documents a bearer token's format, emitted as OpenAPI's `bearerFormat`; nothing checks it. A bearer scheme may also state, for the document only, the OAuth 2 flows or the OpenID Connect discovery URL that issue its tokens, so documentation tools and client generators can obtain one: `oauth2: { flows: <OpenAPI OAuth Flows Object> }` or `openIdConnect: <url>`, never both. The run time is unchanged: the authenticate hook checks the token. `csrf` on a cookie scheme names the header scheme a cookie write must also present; CSRF is derived from it, never written on an identity (FR-27, SCN-008, SCN-077). CSRF is opt-in ([A34](../decisions.md#a34)): a cookie scheme without `csrf` derives no CSRF check, and the lint rule `seampact/cookie-without-csrf` reports it, silenced with a reason through `lint.allow` on the scheme, or switched off with `lint.rules` (section 12). A `signature` scheme declares (details and test vectors: ADR 0013):

```yaml
# shared/base.yaml (excerpt)
schemes:
  stripeSignature:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }
```

`name` is the header carrying the signature, as for a header scheme. `verify` says who reads it: `template` (the default) or `application`. With `template`, the scheme states the layout the boundary parses and the optional helper checks (ADR 0013): `format` holds `{sig}` and optionally `{ts}`; `payload` holds `{rawBody}` and optionally `{ts}`; `tolerance` is required when `{ts}` is used and refused otherwise. `{sig}` and `{rawBody}` appear exactly once and `{ts}` at most once, and the payload signs `{ts}` exactly when the format reads it: a timestamp the MAC does not cover would let a replay pass with a fresh value. `key` is the one way to name the key identifier the application's secret lookup receives (FR-20): `{ value: <literal> }`, or `{ from: <path, query or header source> }`. A `from` source is read per route: every route under an identity whose scheme reads `key.from` must have that parameter (a path placeholder, a declared query field or request header), and a route without it is a compile error naming the route, the identity and the source.

With `verify: application`, the boundary parses nothing: the authenticate hook receives the raw body, the signature header and the other headers listed in `headers`, as received, and verifies with whatever library the sender documents (A25, A40). That serves the senders a template cannot describe: Standard Webhooks (Svix, and so Clerk) signing an id, a timestamp and the body from three headers, Slack's `v0:{ts}:{body}`, Ed25519 signatures (Discord). `format`, `algorithm`, `payload`, `encoding` and `tolerance` are refused there, `key` is optional, and a missing signature header still answers 401 before the hook:

```yaml
# shared/base.yaml (excerpt)
schemes:
  clerkWebhook:
    kind: signature
    verify: application
    name: svix-signature
    headers: [svix-id, svix-timestamp]
  slackSignature:
    kind: signature
    verify: application
    name: X-Slack-Signature
    headers: [X-Slack-Request-Timestamp]
```

Either way the identity is signed, so the compiler forces the raw body and removes CSRF and idempotency keys.

```yaml
# shared/base.yaml (excerpt): one secret per workspace, GitHub style
schemes:
  githubSignature:
    kind: signature
    name: X-Hub-Signature-256
    format: 'sha256={sig}'
    algorithm: hmac-sha256
    payload: '{rawBody}'
    encoding: hex
    key: { from: path.workspaceId }
identities:
  github:
    kind: signed
    scheme: githubSignature
    principal: WebhookCaller
    unknownKeys: { ignore: "GitHub adds payload fields without notice." }
```

#### Identities

```yaml
# shared/base.yaml (excerpt)
identities:
  viewer:
    schemes:
      read: [sessionCookie, bearer]
      write: [sessionCookie, bearer]
      optionalRead: [deviceToken]
    principal: ViewerPrincipal
  viewer_or_device:
    schemes: { read: [sessionCookie, bearer], write: [sessionCookie, bearer], optionalRead: [deviceToken] }
    principal:
      variants: { viewer: ViewerPrincipal, device: DevicePrincipal }
  stripe:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller
```

| Key | Meaning |
|---|---|
| `kind` | `credential` (default) or `signed` |
| `schemes.read`, `schemes.write` | the schemes accepted on reads and on writes, both required, so adding a read scheme never widens writes; `write: []` refuses the identity on writes |
| `schemes.optionalRead` | extra schemes accepted on optional-auth reads only (FR-27, SCN-076) |
| `scheme` | `signed` only: the one `signature` scheme; the compiler forces a raw body and removes CSRF and idempotency keys (FR-20, SCN-026) |
| `principal` | the principal schema, or `{ variants: { <name>: <schema> } }` for an identity accepting several credential kinds; hooks and handlers narrow on the variant name |
| `unknownKeys` | `signed` only: `{ ignore: "<reason>" }` or `{ keep: "<reason>" }`; the body input of every route of the identity drops or keeps unknown keys instead of refusing them (ADR 0003 section 4), for a sender whose payloads grow without notice |
| `errors` | codes attached to every route of the identity, as a list of codes |
| `headers` | the identity headers it uses, below |

Identity headers (FR-28) are declared in the `headers` catalogue, so a pack can supply their names without the identity that uses them (SCN-079), and each identity names the ones it uses with the facts of that use:

```yaml
# packs/house.yaml (excerpt)
headers:
  deadline: { name: X-Deadline, in: request, semantic: deadline }
  trace: { name: traceparent, in: request, semantic: traceContext }
  actorSurface: { name: X-Actor-Surface, in: request, semantic: actorSurface }
  rightsVersion: { semantic: versionToken, response: X-Rights-Version, request: If-Rights-Version }
```

```yaml
# studio/base.yaml (excerpt)
identities:
  operator:
    schemes: { read: [sessionCookie], write: [sessionCookie] }
    principal: OperatorPrincipal
    headers:
      rightsVersion: { from: principal.rightsVersion, for: writes, required: false, stale: api.rights_version_stale }
```

A header declaration takes `name`, `in` (`request` or `response`), `semantic` and optionally `schema`. `semantic` lets targets generate behaviour: `deadline` (an instant; the client computes it from the budget, the server exposes the remaining time and answers 504 from the `deadlineExceeded` role once it has passed), `traceContext` (relayed, never refused when malformed), `actorSurface` (a strict enum, named by `schema`), `versionToken`. A `versionToken` declares `response` and `request` names instead of `name` and `in`, because one fact drives two headers: the response header on every success and an optional request header compared on use.

A use takes `for` (`all`, `reads` or `writes`; for a `versionToken`, the request header's), `required` (default `false`), `schema` when the declaration has none (setting it in both places is an error), and for a `versionToken` `from` (the principal field) and `stale` (the code answered to a stale request header). The header names are the contract's or a pack's, never the core's (SCN-079).

#### Principal requirements and bindings

```yaml
# tasks/api.yaml (excerpt: route settings)
principal: { requires: [profileId] }
bindings: { body.profileId: principal.profileId, path.profileId: principal.profileId }
```

`principal.requires` lists principal fields that must be present; a principal without one answers 403 after authentication, and the handler receives the field as non-optional (SCN-034). `bindings` maps a request value to a principal field; a mismatch answers 403 before the handler (SCN-010). Both answers use the `forbidden` role (section 11).

#### Requirements

`requires` is an ordered list. Each item names either a right or a rule (FR-5):

```yaml
# tasks/api.yaml (excerpt: route settings)
requires:
  - { rule: throttle, bucket: write }
  - { right: roles, params: { allowed: [owner, editor] } }
  - { right: tasks.update }
  - { right: tasks.update, subject: path.taskId }
```

| Key | Meaning |
|---|---|
| `right` or `rule` | the catalogue name |
| `params` | the values of the right's or rule's typed params |
| `subject` | rights only: a value source; see below |
| `bucket` | rules declared with `bucket: true` only: a bucket name |

A requirement written on several routes is named once in the `requirements` catalogue and used by its name, a plain string in `requires`:

```yaml
# tasks/api.yaml (excerpt)
requirements:
  channelEditor: { right: roles, params: { allowed: [owner, editor] } }
  writeThrottle: { rule: throttle, bucket: write }
```

```yaml
# tasks/api.yaml (excerpt: route settings)
requires: [writeThrottle, channelEditor, { right: tasks.update }]
```

An entry holds one requirement item, with the keys above. In `requires`, a plain string always names an entry and a mapping is always an item, so an entry never hides a right of the same name. The IR holds the expanded item, with `entry` naming the catalogue entry it was written through (ADR 0004), and every rule of this section applies to it as if it were written at the use.

The check order is fixed (FR-5, ADR 0012): transport refusals, authentication, principal requirements, scopes in nesting order, requirements in the order of this list, input validation, restricted input fields and sort keys, bindings, the handler. A requirement may sit on a public or optional-auth route; its hook then receives a null principal for an anonymous caller (SCN-036). A rule may always; a right only when it is guest-enabled (below).

#### Rights

```yaml
# shared/base.yaml (excerpt)
rights:
  roles:
    params: { allowed: { type: array, items: { enum: Role }, minItems: 1 } }
    subject: { scope: channel }
  tasks.update:
    subject: { resource: Task, id: TaskId }
    errors: [api.forbidden, api.not_found]
  articles.read:
    subject: { resource: Article, id: ArticleId }
    guest: "Published articles are readable without an account."
```

| Key | Meaning |
|---|---|
| `params` | a fields map or a schema name; typed in the decide request |
| `subject` | absent (none), `{ scope: <scope> }`, or `{ resource: <Name>, id: <id schema> }` |
| `guest` | a reason; required for the right to appear on a public or optional-auth route, where an anonymous caller reaches it (SCN-063) |
| `errors` | the denial codes the decide hook may answer; default the code of the `forbidden` role |
| `codeName` | the identifier generated code uses for the right, when its name yields a poor one or none (`'*'`, ADR 0007); the name the hooks receive is unchanged |
| `summary`, `description`, extension keys | docs and consumer metadata that reach the generated boundary (A20, SCN-064) |

At the use site, a resource subject defaults to the nearest member id whose schema is the right's `id` schema (`path.taskId` for `tasks.update` under `tasks`); otherwise `subject` is required. The source's schema must equal the subject's id schema (SCN-062). A scope subject takes the route's resolved scope; a route without that scope is a compile error. Roles, permissions and custom questions are all rights (FR-22); naming conventions and derived rights come only from opt-in packs (FR-26, SCN-073).

#### Rules

```yaml
# shared/base.yaml (excerpt)
rules:
  throttle:
    bucket: true
    errors: [api.rate_limited]
  recentAuth:
    params: { intent: { enum: ReauthIntent } }
    proof: { in: body, name: reauthToken, schema: ReauthToken }
    errors: [api.reauthentication_required]
```

A rule is a pre-handler check that is not a right: no subject, no use on fields, sort keys or lists. `params` and `errors` are as for rights. `bucket: true` makes each use name a bucket, whose key sources and limits reach the decide hook; the 429 reply and its `Retry-After` come from the conventions (FR-41, SCN-096). `proof` declares a value the rule reads from the request (`in: body` or `in: header`): the compiler adds the field to the route's input once, after the authored fields, and marks it sensitive (SCN-097). A body proof is refused on a route without a body, which is a `get`, or a `delete` without `input`; on any other route without `input` (a POST action such as `revealStreamKey`), the proof becomes the whole input.

#### Buckets

```yaml
# shared/base.yaml (excerpt)
buckets:
  signInPerEmail: { key: [body.email, address], limit: 10, window: 15m }
  export: { key: [principal.accountId] }
```

`key` lists the sources counted; `limit` and `window` may be left for the server to bind, and the compiler then warns (SCN-096). A bucket key is checked at each use: a `body.<field>` key must name a string or integer field of the route's input, checked against that field's schema when the rule reads it (step 5 of the check order, as for a body proof); a missing field, and a `principal.<field>` key on a public or optional-auth route, where the principal may be null, are compile errors naming the bucket and the route.

#### Scopes

```yaml
# shared/base.yaml (excerpt)
scopes:
  org: { id: OrgId, errors: [api.not_found] }
  project: { id: ProjectId, within: org, errors: [api.not_found] }
  tenant: { id: TenantId, errors: [api.forbidden] }
```

A scope catalogue entry declares the id schema, an optional parent scope (`within`) and the membership denial codes. A node enters scopes with `scopes`, a mapping from scope name to a value source:

```yaml
# tasks/api.yaml (excerpt: node settings)
scopes: { org: subdomain, project: path.projectId }
```

`resolver` means the application implements the resolver (A23, SCN-070). Scopes resolve in nesting order: a scope entered at an ancestor before one entered below it; inside one node, a parent scope before its child, then by name. A scope entered below its own child scope is an error (FR-24, SCN-069).
