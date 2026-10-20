### 12. Enums, examples, docs, extensions, lint

```yaml
# shared/base.yaml (excerpt)
enums:
  Role: { values: [owner, editor, viewer], reason: "Roles are local to this product." }
  PublicationState: { values: [draft, published, withdrawn], source: { vocabulary: domain.publication } }
  ErrorNature: { values: [refused, unavailable, failed], fallback: unavailable, reason: "Mirrors the core natures." }
  Answer: { values: ['yes', 'no'], reason: "A survey answer." }
```

An enum declares `values` (strings, unique), and optionally `source` and `reason` (FR-29): an enum without `source` is local to the contract, and `reason` says why, as docs. `codeNames: { <value>: <name> }` gives a member the identifier generated code uses when its value makes a poor one (`'+'`, `class`), the wire value unchanged (ADR 0007). `source: { vocabulary: <name> }` names an external vocabulary: the name is a free label for the reader, with no declaration and no pattern. `source: { enum: <Enum> }` takes another enum's values as its own, so `values` is omitted; a subset at one use is a narrowing (ADR 0003 section 7), not a new enum. `fallback` names the member a client decoder maps an unknown value to (SCN-080). Narrowing happens at a use, inside a schema (ADR 0003). Members such as `yes` and `no` must be quoted (section 3).

Examples are named, on a route, and parsed against their schema at compile time (FR-3, SCN-006):

```yaml
# tasks/api.yaml (excerpt: route settings)
examples:
  firstPage: { status: 200, value: { $file: ./examples/search-200.json } }
  minimal: { request: true, value: { title: 'Write the brief' } }
  emptyTitle: { error: api.schema_invalid, value: { issues: [{ pointer: /title, rule: minLength }] } }
```

An example targets exactly one of a success status, the request (`request: true`), or one of the operation's error codes (`error: <code>`); a status the route does not declare, or one that answers no body, is a compile error. An error example's `value` is the code's params, parsed against its params schema; a code the operation does not list is a compile error naming it, and the emitter writes the params inside the format's error body, under the code's status. It shows the case of this route (here, an empty title), while the registry's `example` stays the code's default (section 11). Schema examples are ADR 0003. A success example's `value` is what the handler returns: the payload for an item, the item array for a list (paged or not), the id-keyed object for a table. It is parsed against that schema, and the OpenAPI emitter wraps it through the operation's format and paging style before writing it, so an example never restates an envelope (A30).

Docs are `summary` (inline) and `description` (inline or `$file`) on apis, nodes, routes, errors, rights, rules, scopes, identities and enums; schemas use JSON Schema's `title` and `description` (FR-34, SCN-088).

Consumer extension keys (FR-10, SCN-016) are declared with a JSON Schema under a prefix:

```yaml
# shared/base.yaml (excerpt)
enums:
  TaxBasis: { values: [inclusive, exclusive], reason: "Acme's tax rules." }
extensions:
  acme:
    tax-basis:
      at: [operation, property]
      schema: { enum: TaxBasis }
    invalidates: { at: [operation], schema: { type: array, items: { type: string } } }
```

An extension's `schema` is written in the subset of ADR 0003, like any schema. `at` lists where the key may appear: `api`, `operation` (any tree node, inherited), `schema`, `property`, `right`, `rule`, `scope`. The key is written `x-<prefix>-<key>` at its place of use (`x-acme-tax-basis: inclusive`). On a property the key extends the property, even when the property holds an inline object: the schema hoisted from that object carries none. A mapping that is no place, such as an inline scalar, array or enum use, or a query field, holds no extension key: one written there is a compile error. A core keyword never starts with `x-`, so an extension never collides with one, and no domain key becomes a core keyword (SM-6). The compiler validates every value with a located diagnostic.

Lint is the contract's to tune (A36, FR-12, SCN-018). `lint.rules` on the api, its base, the shared file or a pack sets each rule's severity, `disabled`, `warning` or `error` (not `off`, which YAML 1.1 reads as a boolean, section 3), merged by leaf like `conventions`; a rule at `error` fails `compile`, one `disabled` does not run. `lint.allow: { <rule id>: "<reason>" }` on a node, a schema, a property or a catalogue entry (a scheme, an identity, a right, a rule, a scope) silences one rule there, and on a node it reaches every node below it, except an allow of `seampact/subtree-exception`, which holds for its own node only (section 8). Silencing one place keeps a reason, since the api kept the rule on; switching a rule off for the whole api needs none. Lint ids name rules only: no setting silences a compile error (ADR 0006 section 4). The core rules:

| Rule | Default | Reports | Silenced on |
|---|---|---|---|
| `seampact/subtree-exception` | warning | a safety exception written above a route or surface root (section 8) | the node |
| `seampact/cookie-without-csrf` | warning | a cookie scheme without `csrf` (section 9) | the scheme |
| `seampact/redundant-maturity` | warning | a stated maturity equal to the derived one (section 10) | the node |
| `seampact/field-right-unresolved` | warning | an output field always absent on a route, its subject not found (ADR 0003 section 6) | the property, or the node |
| `seampact/credential-name` | warning | a property named like a credential and not `sensitive` (ADR 0003 section 6) | the property or schema |
| `seampact/unused-declaration` | warning | a declaration no operation, identity or convention reaches (ADR 0004 section 2) | the catalogue entry |
| `seampact/not-found-role` | warning | a declared 404 code beside the derived notFound code on a route (section 11) | the catalogue entry |

```yaml
# shared/base.yaml (excerpt)
lint:
  rules: { seampact/credential-name: disabled, seampact/cookie-without-csrf: error }
```
