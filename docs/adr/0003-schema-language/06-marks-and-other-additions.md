### 6. Marks and other additions

These keywords are not JSON Schema. Each compiles to an explicit IR field. On a `$ref` (or a plain-string reference written as `{ $ref: X, ... }`), only these and the annotations `title`, `description`, `deprecated`, `default` and `examples` may sit beside it.

| Keyword | Where | Meaning |
|---|---|---|
| `nullable: true` | any schema | section 5 |
| `sensitive: true` | a property or a scalar schema | the value is secret: `format: password` in OpenAPI, redacted by generated serializers in logs, traces and idempotency storage, and `Cache-Control: no-store` on any response carrying it, error replies whose code's params reach it included, or a compile error instead under `conventions.cache.sensitiveElsewhere: refuse` for a value outside a success body (CHK-026, SCN-054); a route declaring a `cache` family other than `never` and returning it is a compile error (ADR 0002 section 10) |
| `codeName` | a property | the identifier generated code uses for the property, when its wire name makes a poor one (`class`, `2fa`); the wire name is unchanged (ADR 0007) |
| `restrictedTo` | a property | the property is visible or writable only with a right (below) |
| `discriminator` | a union | section 3: a property name, or `{ from: header.<Name> }` on a route's whole input |
| `typeName` | a named object schema | the value the `$resource` slot writes (a JSON-LD `@type`), when it differs from the schema name (ADR 0002 section 13) |
| `unknownKeys` | an object schema, a union or a reference, on input | `refuse`, `{ ignore: <reason> }` or `{ keep: <reason> }`: unknown keys are refused, dropped or kept, in this object and every object below it (section 4) |
| `lint: { allow: { <rule>: <reason> } }` | a schema or property | silences one lint rule there, with a reason (ADR 0002 section 12) |
| `x-<prefix>-<key>` | where the extension's `at` allows | a consumer extension (ADR 0002 section 12) |

The lint rule `seampact/credential-name` flags a property whose name looks like a credential (`password`, `secret`, `token`, `apiKey` and similar) and is not marked `sensitive`, unless allow-listed with a reason or switched off for the api (ADR 0002 section 12, FR-12, SCN-018). A rule proof (ADR 0002 section 9) is sensitive by construction.

`restrictedTo` (FR-23, A21):

```yaml
# tasks/schemas.yaml (excerpt)
UpdateTask:
  type: object
  properties:
    title: { type: string, minLength: 1, maxLength: 200 }
    effort: { type: integer, minimum: 0, restrictedTo: tasks.seeEffort }
    note: { type: string, maxLength: 2000, restrictedTo: { right: tasks.annotate, input: strip } }
    budget: { $ref: Money, restrictedTo: { right: roles, params: { allowed: [owner] } } }
```

- The short form names a right. The long form takes `right`, `params` and `input` (`reject` or `strip`, overriding `conventions.restrictedInput`).
- The subject is never written: it follows from the right's declaration (ADR 0002 section 9), so the same fact is not stated twice. A right without a subject has none. A scope right takes the route's resolved scope. A resource right takes, on output, the holder's property whose schema is the right's `id` schema; on input and for a sort key, the route's default subject, by the rule of `requires` (the nearest member id).
- On input and for a sort key, a subject that cannot be found is a compile error naming the field, the right and the route. On output it is not: the field is always absent on that route, which is what deny by default gives, and the lint rule `seampact/field-right-unresolved` reports it, silenced with a reason through `lint.allow`. A schema with a scope-restricted field can therefore be returned by a route outside that scope, such as a service route that has no membership to resolve; it never sends the field there. Until the IR can say "always absent" on a field right, the compiler refuses such an output field with an error instead, which is stricter and reversible.
- A relay route (ADR 0002 section 7) has no field rights, on output or on input: it sends every field to the gateway, whose public operation projects the output and checks the input for its own caller. Without the exception, the service would ask its decider about a member's right for a service principal, and a denial would drop a field that the gateway could never return to a member who holds the right.
- A `create` route, and any route of a collection scope, has no member id, so a field restricted by a resource right cannot be part of its input. A field that a create input restricts takes a scope right or a right without subject (`effort` in `CreateTask` under a scope right, while `UpdateTask` keeps the resource right).
- A restricted property is optional by nature: listing it in `required` is an error with the fix "remove it from required".
- On output, a field whose right the caller lacks is absent, never null; on a public route it is always absent unless the right is guest-enabled (SCN-065, CHK-025).
- On input, a restricted field sent without the right answers 403 from the `forbidden` role with the field pointer, or is stripped (SCN-066, CHK-092).
- A sort key inherits its field's restriction (ADR 0002 section 10).
- The IR materialises, per operation, every field right with its schema, pointer, right, params, subject and direction, so targets never walk schemas to find them (ADR 0004). An operation reaches at most 1000 restricted fields from its input and responses, counted for each use of a restricted field (a schema held by two union variants counts twice); more is a compile error naming the operation, since each one is an entry of its field rights.
- A restricted field reached from a query parameter, a header, the params of an error or the JSON content of a text field is a compile error (`field-right-position`), as are two different restrictions at one pointer (`field-right-conflict`) and a sort key whose list item is not an object or a union of objects, whose resource right takes its id from a property of the item, or whose right has params (`sort-key-right`); each is refused until the IR can express it.
- A restricted field reachable below a recursive reference (a `Comment` whose `replies` hold `Comment`) is a compile error naming the schema: its pointers would have no end, so the IR could not list its field rights.
