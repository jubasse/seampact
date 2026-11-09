### 3. Tagged unions

```yaml
# shared/schemas.yaml (excerpt)
Notice:
  discriminator: kind
  oneOf:
    assigned: TaskAssigned
    done: TaskDone
TaskAssigned:
  type: object
  required: [taskId, assignee]
  properties: { taskId: TaskId, assignee: UserId }
TaskDone:
  type: object
  required: [taskId]
  properties: { taskId: TaskId }
```

`oneOf` is a mapping from tag value to variant, and `discriminator` names the tag property. This is the only union. The mapping is written once: the list of variants and the mapping of OpenAPI are both derived from it, which removes a copy that could drift. Every variant is an object schema, named or inline (an inline variant is named from the union and the tag, ADR 0007); a variant may hold no property but its tag (`cancelled: { type: object }`), which is common. A variant does not declare the tag property itself. The union adds it, as a required string with the tag value, inside the union only: a named variant used on its own, or in another union with another discriminator or tag, keeps its own shape there.

Behaviour (FR-3, SCN-033, CHK-024): strict on server input (a tag outside the mapping is refused with 400), emitted as `oneOf` plus `discriminator` with `propertyName` and `mapping` in OpenAPI, and read by every client target with an explicit unknown-variant branch that keeps the raw value (a TypeScript union plus an `unknown` case; a sealed hierarchy plus `Unknown` in Kotlin and Java; an `Unknown` class in PHP).

A variant may be an `allOf` of object schemas, which is an object schema once merged (section 1): variants that share fields write them once in a named schema and merge it.

A union used as a route's whole `input` may read its tag from a request header instead of a body property, for senders that name the payload type outside the body (GitHub sends every event to one URL and names it in `X-GitHub-Event`):

```yaml
# hooks/schemas.yaml (excerpt)
GithubEvent:
  discriminator: { from: header.X-GitHub-Event }
  oneOf:
    push: GithubPushEvent
    ping: GithubPingEvent
```

`discriminator: { from: header.<Name> }` takes the tag from that header, and the variants keep their own shape: no tag property is added to them. The compiler adds the header to the route's request headers, required, with the tags as its values; declaring it in the route's `headers` too is a compile error ("remove it; the discriminator adds it"). On input, a missing header or a value outside the mapping is refused with 400, and the body is validated against the variant the header names. Only a request has headers, so such a union is allowed only as the whole `input` of a route; in any other position (a property, an item, an output, a variant) it is a compile error. The OpenAPI emitter writes `oneOf` without `discriminator`, plus `x-seampact-discriminator: { in: header, name: X-GitHub-Event }`, and the header parameter with its enum; a client target takes the variant name with the body and sets the header from it.
