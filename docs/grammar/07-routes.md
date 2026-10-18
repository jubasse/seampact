### 7. Routes

```yaml
# tasks/api.yaml (excerpt: a member route)
assign:
  method: post
  summary: Assign the task to a member of the channel.
  requires:
    - { right: roles, params: { allowed: [owner, editor] } }
  input:
    type: object
    required: [userId]
    properties: { userId: UserId }
  output: Task
```

| Key | Meaning |
|---|---|
| `method` | `get`, `post`, `put`, `patch` or `delete` |
| `path`, `pathParams` | the segment and the schemas of its extra placeholders (all required) |
| `operationId` | replaces the derived id |
| `query` | a fields map, or a schema name; an object-typed field and a list are encoded as `conventions.query` says, and an undeclared key is refused (FR-30) unless `unknownQuery` says otherwise (below). Written on a node, it reaches the safe routes below it only (section 8) |
| `headers` | request headers: a fields map keyed by header name |
| `input` | the body schema, in the media `inputMedia` names. A `get` takes no `input`, since a get request carries no body: its fields go in `query` |
| `inputMedia` | `json` (the default, `application/json`), `form` (`application/x-www-form-urlencoded`) or `multipart` (`multipart/form-data`); see "Bodies beyond JSON" below |
| `output` | the body of the single success response, always the whole payload: its status is the op's default, or `200` |
| `item` | instead of `output`, on a route that is a list: the schema of one record (section 10) |
| `responses` | several responses keyed by status, instead of `output`; a route that writes none of `output`, `item` and `responses` answers `204` with no body |
| `paging`, `sortable`, `filteredBy` | list behaviour (section 10) |
| `degradable` | optional success-data paths that may be missing (FR-32) |
| `relays` | `<api>.<operationId>`: marks a relay route, whose shape is derived from that public operation (below, FR-8) |
| `examples` | named examples (section 12) |
| `summary`, `description` | docs |

Query wire kinds (number, boolean, list, text, object) derive from each field's schema type and need no keyword (FR-30, SCN-081). How a list and an object travel is a convention with a default (A36): `conventions.query.lists` is `repeat` (`tag=a&tag=b`, the default), `comma` (`tag=a,b`) or `brackets` (`tag[]=a&tag[]=b`, PHP's native form, which API Platform's filters use), and `conventions.query.objects` is `explode` (an object's members as top-level keys, the default) or `deepObject` (`filter[state]=open`). A server target decodes from the raw query string with these rules, never from the platform's parsed query (PHP's `$_GET`, which keeps only the last of `tag=a&tag=b`; Express's `query parser` setting), so no framework setting changes what the contract accepts. Names and values are decoded as a form (`application/x-www-form-urlencoded`): `+` is a space and a percent escape is a byte, as Express's and Fastify's parsers and browsers' forms do, so a client percent-encodes a literal `+` as `%2B`. A map has no query wire, since no wire encodes its free keys: a map-typed query field or header rule proof is a compile error, while a body proof in a JSON body may hold one.

An undeclared query key is refused by default. Tracking parameters (`utm_*`), cache busters and parameters a gateway adds make that too strict for some apis, so the policy is a default with a reasoned exception (A36, A40): `conventions.query.unknownKeys: { ignore: "<reason>" }` sets it for the api, and the inherited setting `unknownQuery` (`refuse`, or `{ ignore: "<reason>" }`) sets it for a subtree or a route, the nearest winning. Ignored keys never reach the handler.

```yaml
# tasks/api.yaml (excerpt: settings of a surface root)
unknownQuery: { ignore: "Marketing links add utm_* parameters to every page." }
```

`responses` maps a status to `{ body, headers, description }`; `headers` is a fields map of response headers keyed by name. It serves several 2xx on one route (SCN-038), a `202` with `Location` and `Retry-After` (SCN-039), a `DELETE` answering 200 with a body (SCN-040), and redirects (below). Only success and redirect responses are written here; error responses come from error codes (section 11).

```yaml
# tasks/api.yaml (excerpt: a member route)
export:
  method: post
  responses:
    202:
      headers: { Location: Url, Retry-After: RetryAfterSeconds }
```

#### Bodies beyond JSON

Uploads, downloads, form posts and redirects are part of the contract, typed like any body ([A39](../decisions.md#a39)), and every target renders them with its framework's own mechanism (ADR 0012).

```yaml
# tasks/api.yaml (excerpt: member routes of tasks, and a hook)
attach:
  method: post
  inputMedia: multipart
  bodyLimit: 25MiB
  input:
    type: object
    required: [file]
    properties:
      file: { file: { media: [image/png, image/jpeg, application/pdf], maxSize: 20MiB } }
      caption: { type: string, maxLength: 200 }
      meta:
        type: string
        contentMediaType: application/json
        contentSchema: AttachmentMeta
  output: Attachment
download:
  method: get
  output: { file: { media: [application/pdf, text/csv] } }
slackCommand:
  method: post
  identity: slack
  inputMedia: form
  input: SlackCommand
  output: SlackReply
```

- `inputMedia: form` reads an `application/x-www-form-urlencoded` body. `input` is then an object whose fields decode like query fields (section 7: numbers, booleans, lists and objects as `conventions.query` says), plus text fields holding JSON (below). Slack's slash commands and its interactivity `payload` arrive this way.
- `inputMedia: multipart` reads a `multipart/form-data` body. Its fields are those of a form, plus files: a field whose schema is `{ file: { media, maxSize } }`, or an array of them (`maxItems` bounds the count). `media` lists the accepted media types or ranges (`image/*`), checked against each part's declared `Content-Type`; `maxSize` bounds one file. A file outside `media` or above `maxSize` is an input issue (400 from `schemaInvalid`, rule `media` or `maxSize`); a body above the route's `bodyLimit` is 413, and a `bodyLimit` smaller than a file's `maxSize` is a compile error naming both. The handler receives each file as the framework's own upload object (name, media type, size, content), its client file name untrusted text.
- A text field of a form or multipart body may hold JSON: `contentMediaType: application/json` with `contentSchema`, the JSON Schema keywords for it (ADR 0003 section 1). The text is parsed and validated against the schema with the input rules, and the handler receives the parsed value.
- A file as `output`, or as the `body` of a `responses` entry, is a download: the handler returns the content (bytes or a stream), its media type when `media` lists several, and optionally a file name and `disposition` (`attachment` by default, or `inline`), which the boundary writes as `Content-Disposition`. A download bypasses the wire format: it is never wrapped. With `cache.etag`, the handler also returns the entity tag, since the boundary does not buffer a stream to hash it.
- A redirect is a `responses` entry keyed 301, 302, 303, 307 or 308, with no body; the compiler adds its `Location` header, required and typed as a `uri-reference`, and the handler returns the status (when the route has several) and the location. That covers an OAuth callback (302 to the app) and a `303 See Other` after a POST. Generated clients return the status and the location instead of following the redirect where the platform allows it; a browser fetch follows it, so a browser client documents a redirect route as one to navigate to.

```yaml
# tasks/api.yaml (excerpt: an OAuth callback and a form post)
oauthCallback:
  method: get
  access: { public: "The provider redirects the browser here before any session exists." }
  query: { code: { type: string }, state: { type: string } }
  responses: { 302: {} }
submitFeedback:
  method: post
  inputMedia: form
  input: Feedback
  responses: { 303: {} }
```

Form and multipart writes are writes like any other: CSRF on a cookie scheme that declares it, and the idempotency key when enabled, apply to them. A request body of raw bytes (an image sent with `PUT`) is not modelled until a consumer needs it (lesson 5).

#### Relays

A service api (section 5) often serves operations of a public api: the public handler, or a gateway in front of it, forwards the call to a service route. `relays` pairs the two at compile time and derives the service route's shape from the public operation, so no fact is written twice (FR-8):

```yaml
# tasks-service/api.yaml (excerpt)
surfaces:
  internal:
    prefix: /internal/v{version}
    requires: [{ right: callerService, params: { allowed: [catalog] } }]
    routes:
      getTask: { relays: tasks.getTask }
      getTasksBatch: { relays: tasks.getTasksBatch, budget: 100ms }
```

A relay route is marked by `relays: <api>.<operationId>`, naming an operation of a sibling api of the workspace or of an api in `workspace.imports` (section 1). It sits in a surface root's `routes`, and its name is the public operation id, which is also its own; a different name is a compile error naming both, unless the route sets `operationId`. That is how a service api relays two operations of the same id, one from a sibling api and one from an import: `getBillingTask: { relays: billing.getTask, operationId: getBillingTask }`. The link step pairs the two operations by `relays`, whatever the id. The public operation's shape is copied, each copied element carrying `derivedFrom` with the derivation `relay.route` and the public operation's origin:

- the method, and the path after the public surface's prefix, appended to this surface's prefix (`/internal/v1/channels/{channelId}/tasks/{taskId}`), with the schemas of its path parameters;
- the query parameters, the declared request headers, the body input (with its media and its `unknownKeys`), the success responses with their shapes and headers, the paging style and limits of a list, its sort keys without their rights, `concurrency`, and the wire format;
- the codes the public operation answers from its domain rather than from its access: those attached through `errors` on its nodes or by a pack entry, and its `notFound` code (`member.notFound`, `owner.caller`), each with its declaration.

The schemas, enums, scalars, formats, paging styles and error declarations the copies use join this api's IR. A name this api already declares must be the same declaration (a shared file, section 2); a different one is a compile error naming both.

Nothing about access is copied. The public operation's identity, CSRF, idempotency key, scopes, requirements, principal requirements, bindings, field rights, sort-key rights, cache and deprecation belong to the gateway, which checks them before it forwards. The relay route derives no field rights from the copied schemas either (ADR 0003 section 6): the service sends every field, and the public operation projects its output and checks its input for its own caller, so the service never asks a decider about a member's right for a service principal. The relay route runs under the service api's caller identity, inherits its surface's settings like any route, and writes only its `operationId` and the service's own settings: `requires`, `errors`, `errorRoles`, `budget`, `bodyLimit`, `idempotency`, `upstream`, `maturity`, `deprecated`, `tags`, docs and extension keys. Any other shape key on it (`method`, `path`, `pathParams`, `query`, `headers`, `input`, `output`, `item`, `responses`, `paging`, `sortable`, `filteredBy`, `concurrency`) is a compile error naming the public operation it is derived from.

The relay route derives its boundary errors from the copied shape under its own role bindings, like any route: `input.invalid`, `union.headerTag`, `body.limit`, `body.media`, `concurrency.version`, `paging.params`, `paging.gone`. The link step then checks the superset (ADR 0006 section 3): every code of the public operation that is not the gateway's own is a code of the relay route. The gateway's own are the codes of the access and api-wide derivations of ADR 0006 section 5: `identity.authenticate`, `signed.identity`, `csrf.cookieWrite`, `idempotency.write`, `principal.requires`, `binding.mismatch`, `requirement.errors`, `scope.errors`, `fieldRight.restricted`, `sortKey.restricted`, `rule.bucket`, `identity.deadline`, `identity.versionToken`, `api.gateway`, `api.service`, `response.undeclared` and `conventions.every`. Since the domain codes are copied, the check fails only when the two apis bind a boundary role to different codes (the public api answers `request.invalid` for `schemaInvalid`, the service api the default `api.schema_invalid`); the diagnostic names both operations, the missing code and the fix: bind the role to the same code, for the api or with `errorRoles` on the relay route (SCN-014).

`relays` has no run-time part. No target generates a forwarder: the service api's server targets generate the relay route like any route, and the public handler forwards with the service api's generated client when the app generates one (ADR 0011), or with its own code. `api.role: gateway` on the public api (section 5) is independent of it: it derives the 502, 503 and 504 a forwarding api may answer.
