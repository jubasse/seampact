### 2. Shapes

A schema is one of:

- a scalar: `type` `string`, `integer`, `number` or `boolean`, with refinements and an optional `format`;
- an enum use: `enum: Role` (its type is `string`; writing `type` beside it is refused, since the enum already states it);
- an object: `type: object` with `properties` and `required`;
- a map: `type: object` with `additionalProperties: <schema>` and optionally `propertyNames`;
- an array: `type: array` with `items`;
- a tagged union: `oneOf` and `discriminator` (section 3);
- a merged object: `allOf` of object schemas;
- a derived object: `pick` or `omit` of another object schema (below);
- an opaque value: `{ opaque: "<reason>" }` (below);
- a file: `{ file: { media: [<media type or range>], maxSize: <size> } }`, both keys optional, only as a field (or the items of an array field) of a multipart input, or as a whole response body, a download (ADR 0002 section 7). Targets type it as their framework's upload object on input and as content with a media type on output; OpenAPI shows it as `type: string` with `contentMediaType`;
- a reference: a string, or `$ref`, to a named schema.

An object needs at least one property, except a union variant, which may hold only its tag (section 3). A schema with no recognisable shape, such as `{}`, is refused: a free-form value is written as an opaque value, with its reason.

#### Opaque values

Some wire shapes have no type in the subset: a free-form `metadata` blob, a JSON Patch `value`, a webhook's `data.object`, Stripe's expandable field (an id string or an object), a tuple. Refusing them would push the whole route out of the contract, so a schema may say "not checked here", with a reason, since it is an exception to validation ([A36](../../decisions.md#a36), [A40](../../decisions.md#a40)):

```yaml
# hooks/schemas.yaml (excerpt)
StripeEvent:
  type: object
  required: [id, type, data]
  properties:
    id: { type: string }
    type: { type: string }
    data: { opaque: "Stripe's object depends on the event type and its API version." }
```

An opaque value accepts any JSON value, `null` only with `nullable: true`. Targets type it as their untyped JSON value (`unknown` in TypeScript, `JsonNode` in Java, `mixed` in PHP); the handler narrows it. The OpenAPI emitter writes `{}` with `x-seampact-opaque: <reason>`. It holds no refinement, mark or default, and it never sits in a query, a path parameter or a header.

A schema may reference itself, directly or through other schemas, by named reference: a `Comment` whose `replies` are an array of `Comment` is legal, whatever the file layout, because a reference resolves by name (ADR 0002 section 3). An inline cycle cannot be written. A cycle in which every step is a required, non-nullable object property is refused, since no finite value satisfies it. Targets that need it (zod's `z.lazy`) generate the deferral; the shared payload table includes a recursive case.

#### Derived objects: `pick` and `omit`

A create or update input usually holds some of the item's fields with the same constraints. Restating them is a second copy of each constraint, which drifts when one changes ([lesson 1](../../decisions.md#lesson-1)). A derived object keeps them from the source:

```yaml
# studio/schemas.yaml (excerpt)
Article:
  type: object
  required: [articleId, title, state, version]
  properties:
    articleId: ArticleId
    title: { type: string, minLength: 1, maxLength: 200 }
    body: { type: string, maxLength: 20000 }
    state: { enum: PublicationState }
    publishOn: { type: string, format: date }
    version: { type: integer, minimum: 1 }
CreateArticle:
  pick: { from: Article, fields: [title, body, state, publishOn] }
  required: [title]
  properties:
    state: { default: draft }
UpdateArticle:
  omit: { from: Article, fields: [articleId, version] }
  required: []
  properties:
    body: { nullable: true }
    publishOn: { nullable: true }
```

- `pick: { from, fields }` keeps the listed properties of `from`, in the order of `fields`; `omit: { from, fields }` keeps the others, in the source's order. `from` names an object schema: a plain one, an `allOf` or another derived object. A union, a map or a scalar source is refused, and so is a cycle of sources. A field the source does not hold is a compile error naming the field and the source.
- A kept property keeps its schema, refinements, marks (`sensitive`, `restrictedTo`), docs, `lint` and extension keys.
- `required` replaces the source's list for the kept properties. Without it, a kept property stays required when the source requires it. A name in `required` that is not kept is an error.
- `properties` overlays a kept property, and only one: a field to add, or a field whose refinements differ, is a different fact, written in full in an `allOf` beside the derived object. An overlay may set `nullable`, `default`, `restrictedTo`, `title`, `description`, `deprecated` and `examples`, each replacing the source's. `restrictedTo` is there for the create rule of section 6, a field the source restricts by a resource right; `sensitive` is not, since a secret stays one.

The compiler merges a derived object into a plain object, as it does `allOf` (section 1), so targets, lint and the diff see an ordinary named object and never `pick` or `omit`. A change to a source property is therefore a change to every schema that keeps it, and the diff classifies each by that schema's own directions (ADR 0005). A derived object stays a schema of its own, with its own name and directions, so no schema stands for two types and `readOnly` stays refused.
