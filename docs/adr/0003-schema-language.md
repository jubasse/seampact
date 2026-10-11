# ADR 0003: Schema language

Status: accepted

## Context

Every body, parameter, header, principal, error param and rule param of a contract is described by a schema. The schema language belongs to seampact, not to a validator (lesson 6): no zod, class-validator, Bean Validation, Laravel or Symfony idiom may reach the contract or the IR, and every target maps the IR's schemas onto its own validator and type system (FR-3). Brief section 6 sets the base, a stated subset of JSON Schema 2020-12, and the additions: direction, tagged unions, optional versus nullable, portable formats, marks, portable refinements, deterministic names and parsed examples.

The subset has one test: every server target (TypeScript with zod, yup or class-validator, Java with Bean Validation, PHP with Laravel and Symfony validation) and every client target must accept and reject exactly the same payloads for a schema (SCN-028, SM-9). A keyword that one of them cannot check natively and exactly is either refused or given a precise, portable meaning here.

A30 applies: a schema describes the payload only. Envelopes, page shapes and error bodies are wire formats chosen by the contract's conventions (ADR 0002 section 13), never fields of a contract schema.

Schemas are written where ADR 0002 allows one: the `schemas` catalogue, `item`, `input`, `output`, `responses.*.body`, fields maps (`id`, `pathParams`, `query`, `headers`, `params`), `principal`, and the `schema` of an identity header or rule proof. A plain string in those positions names a schema (ADR 0002 section 2).

## Options

1. Full JSON Schema 2020-12, each target doing its best.
2. A new type language (TypeSpec-like or a home-grown IDL in YAML).
3. A written subset of JSON Schema 2020-12, each kept keyword given one portable meaning, plus a few explicit additions that compile to IR fields.

Option 1 is what Arthome's audit warns against: validator quirks leak into the document, and conditional or dynamic keywords have no counterpart in Bean Validation or Laravel rules, so targets would silently check less (FR-14 forbids a weaker check). Option 2 throws away editor support, OpenAPI familiarity and the existing JSON Schema validators the compiler uses. Option 3 is chosen.

## Decision

### 1. Keywords of JSON Schema 2020-12

Every keyword of the 2020-12 vocabularies, kept or refused. A refused keyword is a compile error citing this table's reason (SCN-006).

#### Core vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `$schema` | refused | the dialect is fixed by seampact and the authoring schema |
| `$id` | refused | a schema's identity is its catalogue name; a second identifier would be a second fact |
| `$ref` | kept, with ADR 0002's meaning | identity-preserving references by name or file; siblings allowed only from the annotation and mark list of section 6 |
| `$anchor` | refused | names live in the catalogue |
| `$dynamicRef`, `$dynamicAnchor` | refused | generic, late-bound schemas have no counterpart in any target's type system |
| `$vocabulary` | refused | the vocabulary is fixed |
| `$comment` | refused | YAML comments serve; a `$comment` would reach no output |
| `$defs` | refused | named schemas live in the `schemas` catalogue, one place |

#### Applicator vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `allOf` | kept, restricted | every member is an object schema; the compiler merges them into one object in the IR (a property declared twice with different schemas is an error), so targets never see composition and Java or PHP need no intersection types |
| `anyOf` | refused | an untagged union cannot be decoded by a client without trying each branch, and validators disagree on overlaps; use `oneOf` with a discriminator, or `nullable` |
| `oneOf` | kept, tagged only | section 3; always with a discriminator and a mapping |
| `not` | refused | negative constraints have no native form in Bean Validation, Laravel or Symfony constraints |
| `if`, `then`, `else` | refused | conditional validation is not portable and hides two types in one; use a tagged union |
| `dependentSchemas` | refused | conditional, same reason |
| `prefixItems` | refused | tuples map to no record or class type; no consumer needs them |
| `items` | kept | an array has exactly one item schema |
| `contains` | refused | no native counterpart in most targets; no consumer |
| `properties` | kept | |
| `patternProperties` | refused | key-dependent schemas map to no type; use a map (section 2) |
| `additionalProperties` | kept, map form only | `additionalProperties: <schema>` on an object without `properties` declares a map with string keys; `true` and `false` are refused because direction decides strictness (section 4) |
| `propertyNames` | kept, map form only | the key schema of a map: a string schema with `format`, `pattern`, length or an enum, for tables keyed by id |

#### Unevaluated vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `unevaluatedItems`, `unevaluatedProperties` | refused | direction decides how unknown fields are treated |

#### Validation vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `type` | kept, one value | `string`, `integer`, `number`, `boolean`, `object` or `array`; `null` and type arrays are refused, nullability is `nullable` (section 5) |
| `const` | refused | a one-value field is an enum or a union tag; keeping both would give two ways to state it |
| `enum` | kept, by reference | `enum: <EnumName>` or a narrowing (section 7); inline value lists are refused because enums live in one section and a local enum needs a reason (FR-29) |
| `multipleOf` | kept on `integer` and decimal | refused on `number`, where binary floating point makes the check differ between targets |
| `maximum`, `exclusiveMaximum`, `minimum`, `exclusiveMinimum` | kept | portable range checks (number values only, as in 2020-12) |
| `maxLength`, `minLength` | kept | counted in Unicode code points in every target, as JSON Schema says (a JavaScript target must not count UTF-16 units) |
| `pattern` | kept, portable subset | section 9 |
| `maxItems`, `minItems` | kept | |
| `uniqueItems` | refused | no native, exact check in Bean Validation or class-validator, and "equal" differs for objects; no consumer |
| `maxContains`, `minContains` | refused | `contains` is refused |
| `maxProperties`, `minProperties` | refused | no consumer; map size limits wait for one |
| `required` | kept | the only way to make a property required (section 5) |
| `dependentRequired` | refused | conditional presence; use a tagged union |

#### Format annotation, content and meta-data vocabularies

| Keyword | Decision | Reason |
|---|---|---|
| `format` | kept, closed set | section 8: the portable formats plus named formats declared by packs; any other value is refused, so every target validates the same strings |
| `contentEncoding`, `contentMediaType`, `contentSchema` | refused | binary and embedded documents are not modelled until a consumer needs them |
| `title`, `description` | kept | docs; `description` may be a `$file` |
| `default` | kept, with a semantics | section 10 |
| `deprecated` | kept | emitted to OpenAPI and read by the diff |
| `readOnly`, `writeOnly` | refused | they make one schema stand for two types; a payload that differs between input and output is two schemas (`CreateTask`, `Task`) |
| `examples` | kept | each value is parsed against the schema at compile time (section 11) |

### 2. Shapes

A schema is one of:

- a scalar: `type` `string`, `integer`, `number` or `boolean`, with refinements and an optional `format`;
- an enum use: `enum: Role` (its type is `string`; writing `type` beside it is refused, since the enum already states it);
- an object: `type: object` with `properties` and `required`;
- a map: `type: object` with `additionalProperties: <schema>` and optionally `propertyNames`;
- an array: `type: array` with `items`;
- a tagged union: `oneOf` and `discriminator` (section 3);
- a merged object: `allOf` of object schemas;
- a reference: a string, or `$ref`, to a named schema.

An object needs at least one property, except a union variant, which may hold only its tag (section 3). A schema with no recognisable shape, such as `{}`, is refused: a free-form value has no type in any target.

A schema may reference itself, directly or through other schemas, by named reference: a `Comment` whose `replies` are an array of `Comment` is legal, whatever the file layout, because a reference resolves by name (ADR 0002 section 3). An inline cycle cannot be written. A cycle in which every step is a required, non-nullable object property is refused, since no finite value satisfies it. Targets that need it (zod's `z.lazy`) generate the deferral; the shared payload table includes a recursive case.

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

### 4. Direction

Every use of a schema is input or output, known from where it appears: `input`, `query`, `pathParams`, request `headers` and rule proofs are input; `output`, `responses`, error params and response headers are output; a principal is output of the authenticate hook. The IR records, per named schema, the directions it is used in, and the compiler propagates direction through references, so a schema used both ways is checked both ways (FR-3, CHK-047, CHK-049).

| | Input (strict) | Output |
|---|---|---|
| unknown object keys | refused with 400, every issue reported at once, unless the use ignores them (below) | stripped by the server on emit; kept or ignored by a client on read, never an error |
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

`unknownKeys: { ignore: "<reason>" }` sits on an object schema, a union, or beside a `$ref` (section 6), and acts on input uses only: on a named schema used both ways, an output use is unaffected. Unknown keys of that object, and of every object reached from it in that use (properties, items, map values, variants), are dropped before the handler, never answered with an error and never passed on. Everything else stays strict: a declared field of the wrong type, an unknown enum member or union tag, a missing required field. A signed identity may set it once for the body input of every route under it, with its own reason (ADR 0002 section 9). Query parameters stay strict (FR-30). The shared payload table of the validator targets holds the case: an input with unknown keys at the root and in a nested object is accepted, and the value the handler receives has neither.

Enums are emitted per direction (FR-29): on input always as `enum`; on output as `enum` or, with `conventions.outputEnums: open`, as a string with the members in `x-seampact-enum` (and the fallback in `x-seampact-enum-fallback`). Arthome's documents use the open form, which is why it is a convention and not fixed.

### 5. Optional and nullable

The IR keeps both, as two fields of a property (FR-3, SCN-005):

- optional: the property is not listed in the object's `required`. An absent optional property is absent in every target (`undefined` in TypeScript, an absent key on emit), never turned into null.
- nullable: `nullable: true` on the property's schema. The value may be JSON `null`.

A property may be both. `nullable` replaces JSON Schema's `type: [T, 'null']` and `anyOf` with `null`, because those two spellings would let one fact take two forms; the emitter writes OpenAPI 3.1's type array (or `oneOf` with `null` around a reference).

### 6. Marks and other additions

These keywords are not JSON Schema. Each compiles to an explicit IR field. On a `$ref` (or a plain-string reference written as `{ $ref: X, ... }`), only these and the annotations `title`, `description`, `deprecated`, `default` and `examples` may sit beside it.

| Keyword | Where | Meaning |
|---|---|---|
| `nullable: true` | any schema | section 5 |
| `sensitive: true` | a property or a scalar schema | the value is secret: `format: password` in OpenAPI, redacted by generated serializers in logs, traces and idempotency storage, and `Cache-Control: no-store` on any response carrying it (CHK-026, SCN-054) |
| `restrictedTo` | a property | the property is visible or writable only with a right (below) |
| `discriminator` | a union | section 3: a property name, or `{ from: header.<Name> }` on a route's whole input |
| `unknownKeys: { ignore: <reason> }` | an object schema, a union or a reference, on input | unknown keys are dropped instead of refused, in this object and every object below it (section 4) |
| `lint: { allow: { <rule>: <reason> } }` | a schema or property | silences one lint rule there, with a reason (ADR 0002 section 12) |
| `x-<prefix>-<key>` | where the extension's `at` allows | a consumer extension (ADR 0002 section 12) |

A lint rule flags a property whose name looks like a credential (`password`, `secret`, `token`, `apiKey` and similar) and is not marked `sensitive`, unless allow-listed with a reason (FR-12, SCN-018). A rule proof (ADR 0002 section 9) is sensitive by construction.

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
- On input and for a sort key, a subject that cannot be found is a compile error naming the field, the right and the route. On output it is not: the field is always absent on that route, which is what deny by default gives, and the lint rule `seampact/field-right-unresolved` reports it, silenced with a reason through `lint.allow`. A schema with a scope-restricted field can therefore be returned by a route outside that scope, such as a service route that has no membership to resolve (ADR 0002 section 7); it never sends the field there.
- A `create` route, and any route of a collection scope, has no member id, so a field restricted by a resource right cannot be part of its input. A field that a create input restricts takes a scope right or a right without subject (`effort` in `CreateTask` under a scope right, while `UpdateTask` keeps the resource right).
- A restricted property is optional by nature: listing it in `required` is an error with the fix "remove it from required".
- On output, a field whose right the caller lacks is absent, never null; on a public route it is always absent unless the right is guest-enabled (SCN-065, CHK-025).
- On input, a restricted field sent without the right answers 403 from the `forbidden` role with the field pointer, or is stripped (SCN-066, CHK-092).
- A sort key inherits its field's restriction (ADR 0002 section 10).
- The IR materialises, per operation, every field right with its schema, pointer, right, params, subject and direction, so targets never walk schemas to find them (ADR 0004).

### 7. Enums at a use

```yaml
# studio/schemas.yaml (excerpt)
DateCard:
  type: object
  required: [state]
  properties:
    state: { enum: PublicationState }
    listedState:
      enum: { narrow: PublicationState, to: [published], reason: "Drafts never reach the listing." }
```

`enum: <Name>` uses a catalogue enum (ADR 0002 section 12). `enum: { narrow, to, reason }` narrows it to a strict subset at this use; a `to` that is not a strict subset, or a missing reason, is an error (FR-29, SCN-080, CHK-048). A narrowing keeps the enum's identity: targets type it as the subset of the same enum, and the client keeps tolerating unknown members on output.

### 8. Formats

The closed set (FR-3):

| `format` | On | Wire form | Meaning |
|---|---|---|---|
| `uuid` | string | `8-4-4-4-12` hex digits | RFC 9562 UUID text, either case on input, lowercase on emit |
| `date-time` | string | RFC 3339 with a time offset | an instant; a value without an offset is refused |
| `date` | string | RFC 3339 `full-date` | a calendar date |
| `int64` | integer | a JSON string of decimal digits by default | a 64-bit signed integer. By default a string on the wire in every target, so no JavaScript reader loses precision; `conventions.int64: number` sends a JSON number instead (A36), and a client target that cannot read it exactly fails `generate` (FR-14). Targets type it as their 64-bit integer, or as a string where none exists |
| `decimal` | string | `-?(0\|[1-9][0-9]*)(\.[0-9]+)?` | an exact decimal; range refinements compare numerically and targets use their decimal type |
| `email` | string | a WHATWG HTML "valid e-mail address" | an address a form would accept: no display name, no quoted local part, no IP literal |
| `uri` | string | an RFC 3986 `URI` | an absolute URI: a scheme, then the rest (`https://example.com/a?b#c`) |
| `uri-reference` | string | an RFC 3986 `URI-reference` | a URI or a relative reference (`/tasks/1`, `../a`), as a `Location` header may hold |
| a named format | string, integer | per its declaration | declared by a pack or base, below |

`email`, `uri` and `uri-reference` are checked with the patterns `@seampact/spec` publishes in its format table, through the normalised regular expressions of section 9, never with a library's own check: zod's `email()`, Bean Validation's `@Email` and Laravel's `email` rule each accept a different set. The shared payload table holds their boundary cases (a missing scheme, a space, a non-ASCII character, an empty string).

A plain `integer` without format is a JSON number in the safe range of an IEEE double (from -(2^53 - 1) to 2^53 - 1); a larger value needs `int64`. On input, an integer accepts any JSON number whose value is whole (`1.0` and `1e2` read as 1 and 100, since a JavaScript or PHP decoder cannot tell them from `1` and `100`) and refuses a fraction; a target whose decoder truncates (Jackson's float-to-int coercion) checks the value is whole first. `password` is not authorable: it is what `sensitive` emits.

`date-time` follows RFC 3339 `date-time`: on input, `T` and `Z` in either case, a fraction of 1 to 9 digits, any offset; a leap second (`:60`) is refused, because most target libraries refuse it. On emit, `T` and `Z` are uppercase and the fraction is written as the value holds it, without trailing zeros.

`int64` and `decimal` are strings, so JSON Schema's numeric keywords cannot carry their refinements. The OpenAPI emitter writes them as `type: string` with the format and its pattern (`^-?(0|[1-9][0-9]*)$` for `int64`, the wire form above for `decimal`), and the numeric refinements as `x-seampact-minimum`, `x-seampact-maximum`, `x-seampact-exclusiveMinimum`, `x-seampact-exclusiveMaximum` and `x-seampact-multipleOf`; every target checks them numerically.

Named formats (`money`, `countryCode` and the like) are declared in a `scalars` catalogue, which this ADR adds to the catalogues of ADR 0002 section 1. A named format is a base type plus refinements, so every target can check it with the portable keywords alone, and a target may map it to a native type through its options:

```yaml
# packs/house.yaml (excerpt)
scalars:
  money:
    type: string
    pattern: '^-?(0|[1-9][0-9]*)\.[0-9]{2}$'
    description: An amount with two decimals, in the currency of its context.
  countryCode:
    type: string
    pattern: '^[A-Z]{2}$'
```

A field then writes `{ format: money }`: its type is the scalar's, and writing `type` beside a named format is refused, since the scalar already states it. The portable formats above keep JSON Schema's spelling, `type` with `format`.

### 9. Portable regular expressions

`pattern` (and a scalar's pattern) accepts a subset that ECMAScript (with the `u` flag), java.util.regex, PCRE2 (PHP, with the `u` modifier) and RE2 can all read. The engines still disagree on what `.`, `\s` and `$` match, so the compiler parses every pattern and stores a normalised form in the IR, which each target translates for its engine; no target compiles the written text as is.

- Kept: literal characters; classes `[...]` with ranges and negation; `\d`, `\w`, `\s` and their negations; `.`; quantifiers `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` (greedy); alternation `|`; groups `(...)` and `(?:...)`; anchors `^` and `$`.
- Escapes: only a metacharacter may be escaped (`\.`, `\*`, `\+`, `\?`, `\(`, `\)`, `\[`, `\]`, `\{`, `\}`, `\|`, `\\`, `\^`, `\$`, `\/`), plus `\-` inside a class. A literal `{`, `}` or `]` must be escaped everywhere, and a literal `-` inside a class except as its first or last character. ECMAScript with `u` refuses the other escapes and the lone brackets.
- Refused: backreferences, lookahead and lookbehind, named groups, lazy and possessive quantifiers, `\b`, Unicode property escapes (`\p{...}`), inline flags, and anything outside the lists above.

The normalised meanings, matched per code point:

| Written | Means | Why |
|---|---|---|
| `.` | any code point except `\n`, `\r`, U+0085, U+2028, U+2029 | ECMAScript, Java, PCRE2 and RE2 each exclude a different set |
| `\d`, `\w`, `\s` | `[0-9]`, `[A-Za-z0-9_]`, `[\t\n\v\f\r ]` (ASCII); negations likewise | ECMAScript's `\s` holds Unicode spaces, RE2's lacks `\v` |
| `^`, `$` | the start and the end of the string, never before a final newline | written `^` and `$` for ECMAScript (no `m` flag) and RE2, `\A` and `\z` for Java and PCRE2 |

Semantics are JSON Schema's: a pattern matches anywhere in the string unless anchored, so Java targets use `find()`, never `matches()`. The shared payload table of the validator targets holds a case for each line above: `.` against U+0085 and U+2028, `\s` against `\v` and U+00A0, `$` before a final newline, an escaped `\-` in a class, an escaped `{`, and a recursive schema (section 2).

### 10. Defaults

`default` is allowed on an optional input property or query field, and nowhere else. On a named schema used in both directions, it applies to input uses only and is ignored on output. A default is parsed against its schema at compile time with the strict input rules, like an example. The server boundary applies it after validation, so the handler receives the field as present and its type is not optional. A relay route (ADR 0002 section 7) copies the public operation's input, defaults included, and applies them like any route; the public operation applies the same default before it forwards, so the service receives the value it would have filled itself. Arthome's pass-through rule (research section 6) kept a gateway from freezing a service's default; here the default is one fact that both sides compile from, so no pass-through exception is needed. Client targets do not fill defaults; they document them. This answers the question FR-30 leaves to an ADR.

### 11. Examples

`examples` on a schema is a list of values, each parsed against the schema at compile time with the strict input rules (unknown keys refused), so an example is never looser than a request (FR-3, SCN-006, CHK-053). Named examples on routes are ADR 0002 section 12; an error's example is its params. A schema example describes the payload and reaches OpenAPI unchanged; a route example is also the payload the handler returns (the item, the item array of a list, the id-keyed table), and the emitter wraps it through the operation's format and paging style before writing it (A30).

### 12. Names

Every named schema becomes a named type in every target. An inline schema gets a deterministic name from its position: the operation and the role (`assignTask` input gives `AssignTaskInput`), an inline property from its parent and the property name, an inline union variant from the union and its tag. Names are word segments plus a role in the IR; casing and escaping are per target (ADR 0007). Generated code never contains an anonymous structural type (SCN-033).

### 13. What a schema never holds

- Envelope, page or error-body fields: they come from the wire format (A30, ADR 0002 section 13). A handler returns the unwrapped payload; the IR stores it and a reference to the format.
- Validator idioms: no transform, coercion, custom message, async check or library-specific keyword. Query decoding (strings to numbers and booleans, lone values to lists) is IR data, not a schema behaviour (FR-30).
- Authorization: a schema names a right through `restrictedTo`; it never decides one.

## Consequences

- Phase 1's authoring JSON Schema refuses every keyword marked refused here, with this ADR's reason in the diagnostic.
- The validator targets (zod, yup, class-validator, VineJS, Bean Validation, Laravel, Symfony) each need code for: code-point string lengths, int64 and decimal strings, the regex anchoring rules, unknown-key refusal on input (and dropping under `unknownKeys: ignore`), header-tagged unions, and stripping on emit. The shared payload table tests each case in CI (SCN-028).
- Contracts lose some expressiveness: conditional schemas, `anyOf`, tuples and inline enums must be rewritten as tagged unions, separate schemas or catalogue enums. A refused keyword comes back only with a consumer and an ADR.
- `int64` on the wire is a string by default even for targets that could hold a 64-bit number, which costs one conversion in Java and PHP and buys one wire form for every client; an api that sends numbers says so in its conventions.
- A30 keeps schemas free of wire-format fields, so the same contract can switch formats through its conventions without touching a schema.

## Traceability

- FRs: FR-3 (subset, direction, unions, optional and nullable, formats, marks, refinements, names, examples), FR-12 (credential lint, allow-list), FR-15 (one payload behaviour for zod, yup and class-validator), FR-23 (`restrictedTo`, input policy), FR-29 (enum uses and emission), FR-30 (defaults), FR-42 and A30 (no envelope in schemas).
- CHK items enabled: CHK-002, CHK-024, CHK-025, CHK-026, CHK-033, CHK-047, CHK-048, CHK-049, CHK-053, CHK-080, CHK-092.
