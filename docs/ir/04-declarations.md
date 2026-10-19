### 4. Declarations

```ts
interface ErrorDecl {
  code: ErrorCode;  family?: string;        // the declared family, or the code up to its first dot
  nature: 'refused' | 'unavailable' | 'failed';   // the base nature: every client's retry rule reads this
  natureName?: NatureId;                    // a nature of the 'natures' catalogue, written by '$nature'
  http: { status: number };                 // the status is an HTTP attribute of the error (ADR 0014)
  params?: SchemaRef;  example?: unknown;  title?: string;  docs;
  origin;                                   // the catalogue entry or the tree node that declared it (A35)
  default?: ErrorRole;                      // set when the code is a role's core default (ADR 0006 section 6)
  noStore?: boolean;                        // irRevision 6: its params carry a sensitive value, so every response
                                            // of the code is 'Cache-Control: no-store'
}
interface NatureDecl { id: NatureId; base: 'refused' | 'unavailable' | 'failed'; docs; origin }
interface HeaderDecl {
  id; semantic: 'deadline' | 'traceContext' | 'actorSurface' | 'versionToken';
  name?: string; in?: 'request' | 'response';   // every semantic but versionToken
  response?: string; request?: string;          // versionToken
  schema?: TypeUse; origin;
}

interface Scheme {
  id; kind: 'cookie' | 'header' | 'query' | 'bearer' | 'basic' | 'signature';
  name?: string; csrf?: SchemeId;           // name: the cookie, header or query parameter, or the signature header
  bearer?: { format?: string; oauth2?: { flows: unknown } ; openIdConnectUrl?: string };   // document-only facts
  signature?: { verify: 'template'; format; algorithm; payload; encoding: 'hex' | 'base64'; toleranceMs?: number;
                key: { value: string } | { from: ValueSource } }
            | { verify: 'application'; headers: string[]; key?: { value: string } | { from: ValueSource } };
  origin;
}
interface Identity {
  id; kind: 'credential' | 'signed';
  schemes: { read: SchemeId[]; write: SchemeId[]; optionalRead: SchemeId[] } | { signed: SchemeId };
  principal: SchemaRef | { variants: Record<VariantId, SchemaRef> };
  unknownKeys?: { ignore: Reason } | { keep: Reason };   // signed identities only
  errors: ErrorCode[];
  headers: { header: HeaderId; for: 'all' | 'reads' | 'writes'; required: boolean; schema?: TypeUse;
             from?: ValueSource; stale?: ErrorCode; origin }[];   // uses of the headers catalogue
  docs; extensions; origin;
}
interface Right {
  id; params?: SchemaRef;
  subject: { kind: 'none' } | { kind: 'scope'; scope: ScopeId } | { kind: 'resource'; type: Name; idSchema: SchemaRef };
  guest?: Reason;  errors: ErrorCode[];  docs; extensions; origin; derivedFrom?;   // derivedFrom when a pack declared it
  codeName?: Name;                          // identifier override; the right's name stays its id (ADR 0007)
}
interface Rule {
  id; params?: SchemaRef; takesBucket: boolean;
  proof?: { in: 'body' | 'header'; name: string; schema: SchemaRef };
  errors: ErrorCode[]; docs; extensions; origin;
}
interface Scope { id; idSchema: SchemaRef; within?: ScopeId; errors: ErrorCode[]; docs; extensions; origin }
interface Bucket { id; key: ValueSource[]; limit?: number; windowMs?: number; origin }
interface Service { id; maturity: Maturity; origin }
interface Enum {
  id; name; values: string[];               // written order kept
  codeNames?: Record<string, Name>;         // identifier override per value (ADR 0007)
  source?: { vocabulary: string } | { enum: EnumId };  localReason?: Reason;  fallback?: string;
  directions: Direction[]; docs; origin;
}
```

Every params of a right, rule or error is a `SchemaRef` to a named object schema (an inline params map is hoisted and named, for example `RolesParams`), so every target gets a named type (FR-22).
