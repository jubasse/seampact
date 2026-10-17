### 5. Schemas

```ts
type Schema =                                // a tagged union on 'kind'
  | { kind: 'object'; properties: Property[] }
  | { kind: 'map'; keys?: TypeUse; values: TypeUse }
  | { kind: 'union'; tag: { in: 'body'; property: string } | { in: 'header'; name: string };   // header: a route's whole input only
      variants: { tag: string; schema: SchemaId; docs?: Docs }[] }
  ;                                          // each with id, name, typeName?, directions, examples, docs, extensions, origin, deprecated?
interface Property {
  name: string; type: TypeUse; optional: boolean; nullable: boolean;
  sensitive: boolean; restrictedTo?: FieldRestriction; default?: unknown; deprecated: boolean;
  codeName?: Name;                           // identifier override; the wire name stays 'name'
  examples?: unknown[];
  docs; extensions; origin;
}
type TypeUse =                               // what a property, item, body or parameter is
  | { kind: 'ref'; schema: SchemaId;         // objects, maps and unions are always named
      unknownKeys?: { policy: 'refuse' | 'ignore' | 'keep'; reason?: Reason;   // input uses only (ADR 0003 section 4)
                      origin?: Origin; derivedFrom?: DerivedFrom } }          // origin: the use or 'conventions.input'
  | { kind: 'opaque'; reason: Reason; origin: Origin }   // any JSON value, unchecked (ADR 0003 section 2)
  | { kind: 'file'; media: string[]; maxSizeBytes?: number }   // a multipart field or a download (A39)
  | { kind: 'enum'; enum: EnumId; narrowedTo?: { values: string[]; reason?: Reason } }
  | { kind: 'scalar'; type: 'string' | 'integer' | 'number' | 'boolean'; format?: string; refinements: Refinements;
      content?: { media: 'application/json'; schema: TypeUse } }   // a form or multipart text field holding JSON
  | { kind: 'array'; items: TypeUse; minItems?: number; maxItems?: number };
                                             // each use also with docs?: Docs and examples?: unknown[]
```

- Objects, maps and unions are always named schemas, hoisted to `schemas` with the deterministic name of ADR 0007; scalars, enum uses and arrays stay inline in their use. Generated code therefore never holds an anonymous structural type (FR-3).
- `allOf`, `pick` and `omit` are already merged (ADR 0003 section 2). A union holds where its tag is read (a body property, or a request header for a union that is a route's whole input) and each variant's tag; the variant schema does not hold the tag property, which targets add inside a body-tagged union only (ADR 0003 section 3).
- `unknownKeys` sits on the use of a schema, never on the schema: an `unknownKeys` written on an inline object moves to the use of its hoisted schema, one inherited from a signed identity sits on the operation's input with `derivedFrom` when that input is a `ref` use, the only use that carries `unknownKeys` (an opaque, array or scalar input takes none; a proof-only input included: access.rights copies it there, section 13), and one from `conventions.input.unknownKeys` carries that convention's origin. It covers every object reached from that use. An input use with no `unknownKeys` refuses unknown keys. The names of the input's body proofs (section 13) are known keys of its use: no policy refuses or ignores them, and `keep` never collects them.
- A pattern refinement holds the normalised form of ADR 0003 section 9, never the written text alone.
- `directions` lists `input` and `output` as the schema is used; targets generate per-direction validators from it (ADR 0003 section 4).
- `nullable` and `optional` are two members (FR-3, SCN-005).
- Written annotations are kept, never dropped (irRevision 3): a schema's `deprecated` (absent means false), a property's `examples`, a union variant's `docs` (written beside its schema reference), and the `docs` and `examples` written at the position of a type use, held by that use, optional on every kind. The compiler writes them where the grammar allows them today: the items of an array use, the keys or values of a map schema, the schema of a JSON content. A property and a named format hold their own, and an inline object, map or union keeps them on its hoisted schema; a later position the grammar allows is an additive change.
