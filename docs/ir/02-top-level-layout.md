### 2. Top-level layout

```ts
interface ContractIR {
  irVersion: 1;
  irRevision: number;                       // ADR 0005
  kinds: DeclarationKind[];                 // the declaration kinds present: ['httpOperation'] in 1.0
  features: Feature[];                      // must-understand features used by any operation (ADR 0005); empty at 1.0
  api: Api;
  packs: PackRef[];                         // packs applied, in application order, extended packs included: { name, version }
  conventions: Conventions;                 // resolved values, each with its origin; informative only (section 13)
  formats: Record<FormatId, WireFormat>;    // only the formats this api uses, the default included
  pagings: Record<PagingId, PagingStyle>;   // only the paging styles this api uses
  schemas: Record<SchemaId, Schema>;        // named and hoisted inline schemas
  scalars: Record<ScalarId, Scalar>;
  enums: Record<EnumId, Enum>;
  errors: Record<ErrorCode, ErrorDecl>;
  natures: Record<NatureId, NatureDecl>;    // the contract's own natures (ADR 0002 section 11)
  schemes: Record<SchemeId, Scheme>;
  headers: Record<HeaderId, HeaderDecl>;    // identity headers (ADR 0002 section 9)
  identities: Record<IdentityId, Identity>;
  rights: Record<RightId, Right>;
  rules: Record<RuleId, Rule>;
  scopes: Record<ScopeId, Scope>;
  buckets: Record<BucketId, Bucket>;
  services: Record<ServiceId, Service>;
  extensionKeys: Record<ExtensionKeyId, ExtensionKeyDecl>;   // '<prefix>-<key>' to its schema and allowed places
  lint: { rules: Record<string, 'disabled' | 'warning' | 'error'>;   // resolved severities, each with its origin
          allows: { rule: string; at: Origin; reason: Reason; subtree: boolean }[] };   // ADR 0002 section 12
  operations: Operation[];                  // the 'httpOperation' kind, sorted by id
}
```

- `kinds` lists every declaration kind the document uses. A target declares the kinds it supports and refuses an IR with another kind by name, instead of ignoring an unknown collection (ADR 0014, FR-14). A later transport adds a kind and a sibling collection (for example `channels`); it never adds a value to the HTTP method enum.
- Every declaration that an operation uses is at the top level and referenced by id, never nested in an operation, so a later transport reuses the same declarations (ADR 0014).
- Only declarations reachable from an operation or an identity are kept. A convention is informative and keeps no declaration: a paging style named only by `conventions` is dropped. Lint reports unused declarations from the source (FR-12), not from the IR. Core declarations (section 6) follow the same rule: finalize drops every one no element references, so a default code, its params schema, `ApiEmptyBody` or the default format is in the IR only where something uses it.

```ts
interface Api {
  id: string;  name: Name;                  // 'tasks'
  version: number | string;                 // the path version when an integer; a string only with every surface's pathVersion 'none'
  kind: 'product' | 'service';
  pathVersion: { value: 'prefix' | 'none'; origin };   // conventions.pathVersion; a surface may override it
  role?: 'gateway';
  maturity: Maturity;                       // 'experimental' | 'provisional' | 'stable'
  caller?: { identity: IdentityId; right: RightId };
  compat: { policy: 'additive-only' | 'none' };
  wire: ApiWire;                            // irRevision 4: { int64, outputEnums, urls }, the defaults written too (section 13)
  surfaces: Record<SurfaceId, { name: Name; prefix: string; pathVersion: 'prefix' | 'none'; origin: Origin }>;
  documents: Record<DocumentId, { surfaces: SurfaceId[]; internal: 'include' | 'exclude' }>;
  docs: Docs;  extensions: Extensions;  origin: Origin;
}
```
