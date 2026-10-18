### 9. Canonical ids and ordering

- Ids are the catalogue names as written (schemas, enums, rights, codes...). A derived name (an inline schema, a derived operation id) has the id given by ADR 0007's canonical identifier of its segments. A derived id equal to a declared one is a compile error naming both.
- Records (`Record<...>`) are JSON objects; their order is the serialisation order of section 10.
- Every array of the IR has one order, stated per `Definition.member` below (the `*.examples` row covers every `examples` array). An array is kept in its written or semantic order, or sorted:
  - Sorted arrays compare strings by UTF-16 code units, the member order of section 10 (RFC 8785), and statuses as integers; a tie on the key is broken by the element's canonical bytes (section 10).
  - Derived params follow the declared ones in derivation table order (ADR 0006 section 5), and within one derivation in their source's written order (a paging style's `request`).

| Array | Order |
|---|---|
| `ApiDocument.surfaces` | Sorted by value |
| `ApplicationSignature.headers` | Kept: the verifier's order, which a signature base may depend on |
| `ArrayTemplate.items` | Kept: the items are the value |
| `Bucket.key` | Kept: written order |
| `Cache.perCallerKind` | Sorted by `caller` |
| `Cache.vary` | Sorted by value |
| `ContractIR.features` | Sorted by value |
| `ContractIR.kinds` | Sorted by value |
| `ContractIR.operations` | Sorted by `id` |
| `ContractIR.packs` | Kept: application order |
| `CredentialIdentity.errors` | Sorted by code: a set; `Operation.errors` carries the status order |
| `CredentialIdentity.headers` | Sorted by `header`, then `for` |
| `CredentialSchemes.optionalRead` | Sorted by id |
| `CredentialSchemes.read` | Sorted by id |
| `CredentialSchemes.write` | Sorted by id |
| `Degradable.paths` | Sorted by value |
| `DerivedFrom.from` | Kept in two runs (ADR 0006 section 6): the trigger origins sorted by `api` (absent first), `layer` in the workspace's layer order, then `pointer`; then the binding's origins |
| `Enum.directions` | Sorted by value |
| `Enum.values` | Kept: written order |
| `EnumNarrowing.values` | Kept, in the enum's value order |
| `ErrorShape.headers` | Kept: written order ([A33](../decisions.md#a33)) |
| `ExtensionKeyDecl.places` | Sorted by value |
| `FileTypeUse.media` | Kept: preference order, the first is a download's default |
| `IdentityAccess.schemes` | Sorted by id: a subset of the identity's sorted schemes, with no try order |
| `Lint.allows` | Sorted by `rule`, `at.api` (absent first), `at.layer`, `at.pointer`, `subtree` (false first), then `reason` by its canonical bytes |
| `MapSchema.directions` | Sorted by value |
| `Name.segments` | Kept: the segments are the value |
| `ObjectSchema.directions` | Sorted by value |
| `ObjectSchema.properties` | Kept: written order (A33); properties the compiler adds follow |
| `ObjectTemplate.members` | Kept: written order |
| `Operation.bindings` | Sorted by source |
| `Operation.callerKinds` | Sorted by value |
| `Operation.errors` | Sorted by status, then code |
| `Operation.features` | Sorted by value |
| `Operation.fieldRights` | Sorted by `schema`, then `pointer`, then `direction` |
| `Operation.principalRequires` | Sorted by `field` |
| `Operation.requires` | Kept: written order |
| `Operation.responses` | Sorted by status |
| `Operation.scopes` | Kept: resolution order |
| `Operation.tags` | Sorted by value |
| `Operation.upstream` | Kept: owner first |
| `OperationError.roles` | Sorted by `role` |
| `OperationInput.fields` | Kept: the input schema's property order |
| `OperationInput.proofs` | Kept: requirement order |
| `OptionalAccess.schemes` | Sorted by id: a subset of the identity's sorted schemes, with no try order |
| `Paging.sortKeys` | Sorted by `key` |
| `PagingResponse.headers` | Kept: written order (A33) |
| `PagingResponse.links` | Kept: written order, one `Link` header's order |
| `PagingResponse.meta` | Kept: written order (A33) |
| `PagingStyle.handlerResult` | Sorted by value |
| `PagingStyle.request` | Kept: written order |
| `Params.header` | Kept: declared params in written order, then derived params |
| `Params.path` | Kept: path template order |
| `Params.query` | Kept: declared params in written order, then derived params |
| `Response.headers` | Kept: declared headers in written order, then derived headers as derived params |
| `Right.errors` | Sorted by code: a set |
| `Rule.errors` | Sorted by code: a set |
| `Scalar.directions` | Sorted by value |
| `Scope.errors` | Sorted by code: a set |
| `Shape.headers` | Kept: written order (A33) |
| `SignedIdentity.errors` | Sorted by code: a set |
| `SignedIdentity.headers` | Sorted by `header`, then `for` |
| `SlotTemplate.path` | Kept: the path is the value |
| `SlotTextPart.path` | Kept: the path is the value |
| `TextTemplate.parts` | Kept: the parts are the value |
| `UnionSchema.directions` | Sorted by value |
| `UnionSchema.variants` | Sorted by tag |
| `*.examples` | Kept: written order, for every `examples` array |

Object properties keep the order the author wrote them in (A33), so generated types and Java record constructors list fields as written. ADR 0002 makes that order independent of files: an `$include` merges its keys at its own position, `allOf` members merge in their written order, a `pick` keeps the order of its `fields` and an `omit` the source's order. Properties the compiler adds (a concurrency version field) follow the authored ones. A rule proof read in the body is not a property of the input schema but an element of `input.proofs`, which targets render after the schema's properties (section 13).
