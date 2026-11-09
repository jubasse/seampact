### 4. Direction

Every use of a schema is input or output, known from where it appears: `input` (JSON, form or multipart), `query`, `pathParams`, request `headers` and rule proofs are input; `output`, `responses`, error params and response headers are output; a principal is output of the authenticate hook. A scope's `id`, a right's `subject.id` and a right's `params` are input, read from the request the check runs on; a route's `item` and a format's `meta` field schemas are output, written into the response. The IR records, per named schema, the directions it is used in, and the compiler propagates direction through references, so a schema used both ways is checked both ways (FR-3, CHK-047, CHK-049).

| | Input (strict) | Output |
|---|---|---|
| unknown object keys | refused with 400, every issue reported at once, unless the use ignores or keeps them (below) | stripped by the server on emit; kept or ignored by a client on read, never an error |
| unknown enum member | refused | kept by a client as an unknown member, or mapped to the enum's `fallback` |
| unknown union tag | refused | the client's unknown-variant branch |
| missing required field | refused | a server bug: the server boundary answers 500 from the `undeclaredStatus` role rather than emit it |

No target ever freezes an output enum or union: a server adding a member or a variant is an additive change (ADR 0005).

Strict input is a default with a reasoned exception (A36). A third-party sender whose payloads grow without notice (a GitHub push carries more than a hundred fields, Stripe adds fields to its events) would otherwise force a contract to declare and track every field it never reads:

```yaml
# hooks/routes.yaml (excerpt: route settings)
input:
  $ref: GithubEvent
  unknownKeys: { ignore: "GitHub adds payload fields without notice; the handler reads six." }
```

`unknownKeys` sits on an object schema, a union, or beside a `$ref` (section 6), and acts on input uses only: on a named schema used both ways, an output use is unaffected. It takes one of three values:

- `refuse`, the default: unknown keys answer 400;
- `{ ignore: "<reason>" }`: unknown keys of that object, and of every object reached from it in that use (properties, items, map values, variants), are dropped before the handler, never answered with an error and never passed on;
- `{ keep: "<reason>" }`: the same objects accept unknown keys and pass them to the handler beside the declared fields, as a map of opaque values (a TypeScript index signature of `unknown`, a `Map<String, JsonNode>` on the Java record, a PHP array property), for a handler that forwards or stores what it does not read. In Java and PHP the member that holds the map is named by a target option, `additionalMember` (`additional` by default), and a declared property of a keeping object whose identifier equals it is refused by `generate`, naming the property and the option; a TypeScript index signature has no member name.

Everything else stays strict: a declared field of the wrong type, an unknown enum member or union tag, a missing required field. `conventions.input.unknownKeys` sets the api's default for every body input, so an api that wants the drop-unknown behaviour of Spring's Jackson defaults or Laravel's `validated()` says so once; a use's own value wins, `refuse` included. A signed identity may set it once for the body input of every route under it, with its own reason (ADR 0002 section 9). Query parameters follow `conventions.query.unknownKeys` and `unknownQuery` instead (ADR 0002 section 7, FR-30). The shared payload table of the validator targets holds the cases: an input with unknown keys at the root and in a nested object is accepted, the value the handler receives has neither under `ignore`, and both under `keep`.

Enums are emitted per direction (FR-29): on input always as `enum`; on output as `enum` or, with `conventions.outputEnums: open`, as a string with the members in `x-seampact-enum` (and the fallback in `x-seampact-enum-fallback`). Some existing APIs document their output enums in the open form, which is why it is a convention and not fixed.
