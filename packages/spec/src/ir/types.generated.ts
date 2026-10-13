// Generated from packages/spec/schemas/ir/*.schema.json by src/ir/generate-types.ts. Do not edit.
// Regenerate: UPDATE_IR_TYPES=1 pnpm vitest run packages/spec/src/ir/types.test.ts

/** The unknown arm of a tagged union: a variant this revision does not know, named by its tag. */
export type UnknownVariant<Tag extends string> = { [K in Tag]: string & {} };

/** The id of a named schema: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4, ADR 0007). */
export type SchemaId = string;

/** The id of a named format: its catalogue key (ADR 0003 section 8, ADR 0002 section 4). */
export type ScalarId = string;

/** The id of an enum: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4). */
export type EnumId = string;

/** An error code, the key of the errors catalogue (ADR 0004 section 4, ADR 0002 section 4). */
export type ErrorCode = string;

/** The id of a contract nature: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type NatureId = string;

/** The id of a security scheme: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type SchemeId = string;

/** The id of an identity header: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type HeaderId = string;

/** The id of an identity: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type IdentityId = string;

/** The id of a right: its catalogue key, the name its library uses, without line breaks or leading or trailing space (ADR 0002 section 4). */
export type RightId = string;

/** The id of a rule: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type RuleId = string;

/** The id of a scope: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type ScopeId = string;

/** The id of a rate-limit bucket: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type BucketId = string;

/** The id of a service: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type ServiceId = string;

/** A declared extension key, written '<prefix>-<key>' (ADR 0002 sections 4 and 12). */
export type ExtensionKeyId = string;

/** An extension prefix (ADR 0002 section 4); the compiler refuses 'seampact', which is reserved. */
export type ExtensionPrefix = string;

/** An extension key under its prefix (ADR 0002 section 4). */
export type ExtensionKey = string;

/** The id of a wire format: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type FormatId = string;

/** The id of a paging style: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type PagingId = string;

/** The id of an api surface: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type SurfaceId = string;

/** The id of an api document: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
export type DocumentId = string;

/** The id of a principal variant: its catalogue key (ADR 0004 section 9). */
export type VariantId = string;

/** An operation id (ADR 0004 section 7). */
export type OperationId = string;

/** A derivation id of the derivation table (ADR 0006 section 5), 'pack.<pack>.<entry>' for a pack entry. */
export type DerivationId = string;

/** A must-understand feature name (ADR 0005 section 3); none is defined at irRevision 2. */
export type Feature = string;

/** The written reason of an exception: non-empty, without leading or trailing white space (A36, ADR 0002 section 4). */
export type Reason = string;

/** A reference by id to a named object, map or union schema of the schemas catalogue (ADR 0004 section 4). An id, usually a scalar or a named format, is a TypeUse instead. */
export type SchemaRef = SchemaId;

/** A declaration kind (ADR 0004 section 2, ADR 0014). */
export type DeclarationKind = "httpOperation" | (string & {});

export type Maturity = "experimental" | "provisional" | "stable" | (string & {});

export type Direction = "input" | "output" | (string & {});

/** The role of a name (ADR 0007 section 1). */
export type NameRole =
  | "schema"
  | "input"
  | "output"
  | "query"
  | "headers"
  | "path"
  | "response"
  | "params"
  | "error"
  | "errors"
  | "property"
  | "item"
  | "value"
  | "variant"
  | "endpoints"
  | "operation"
  | "member"
  | "enumMember"
  | (string & {});

/** A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1 and its amendment). */
export interface Name {
  segments: string[];
  role: NameRole;
  /** The HTTP success or redirect status of a 'response' name; present if and only if role is 'response' (invariant ir.name.status, ADR 0004 section 13). */
  status?: number;
}

/** Resolved documentation text. */
export interface Docs {
  summary?: string;
  description?: string;
}

/** The extension slot: { '<prefix>': { '<key>': value } } (ADR 0004 section 3). */
export type Extensions = Record<ExtensionPrefix, Record<ExtensionKey, unknown>>;

/** Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section 6). */
export interface Origin {
  /** Set on an element copied from another api by a relay route. */
  api?: string;
  /** 'api', 'shared', 'base', 'pack:<name>', 'core' for a declaration the compiler supplies (its pointer starts with its entry of formats, errors or schemas, with no side-table entry), or 'workspace' for a diagnostic on workspace.yaml (no IR element carries it). Closed: the one exception to open enums (ADR 0004 section 13). */
  layer: "api" | "shared" | "base" | "core" | "workspace" | `pack:${string}`;
  pointer: string;
}

/** Present on, and only on, an element the compiler derived (ADR 0004 section 6). */
export interface DerivedFrom {
  derivation: DerivationId;
  from: Origin[];
}

/** Where a value is read (ADR 0002 section 4); 'resolver' only as a scope source, 'holderField' only as a field right's subject source. */
export type ValueSourceIn =
  | "path"
  | "query"
  | "header"
  | "body"
  | "principal"
  | "scope"
  | "host"
  | "subdomain"
  | "address"
  | "resolver"
  | "holderField"
  | (string & {});

/** Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal, scope and holderField (the holder's property); no other member with host, subdomain and resolver; 'prefixBits' only with address (invariants ir.value-source.members and ir.value-source.place). */
export interface ValueSource {
  in: ValueSourceIn;
  name?: string;
  prefixBits?: number;
}

/** A base nature: every client's retry rule reads it. */
export type NatureBase = "refused" | "unavailable" | "failed" | (string & {});

/** A role of ADR 0006 section 6. */
export type ErrorRole =
  | "schemaInvalid"
  | "payloadTooLarge"
  | "unsupportedMediaType"
  | "unauthenticated"
  | "csrfInvalid"
  | "idempotencyKeyReused"
  | "idempotencyInProgress"
  | "stateConflict"
  | "preconditionFailed"
  | "preconditionRequired"
  | "notFound"
  | "forbidden"
  | "sortKeyForbidden"
  | "rateLimited"
  | "deadlineExceeded"
  | "gone"
  | "upstreamUnavailable"
  | "serviceUnavailable"
  | "upstreamTimeout"
  | "undeclaredStatus"
  | (string & {});

/** The HTTP attributes of an error code (ADR 0014). */
export interface ErrorHttp {
  status: number;
}

/** An error code of the registry (ADR 0004 section 4). */
export interface ErrorDecl {
  code: ErrorCode;
  /** The declared family, or the code up to its first dot. */
  family?: string;
  nature: NatureBase;
  natureName?: NatureId;
  http: ErrorHttp;
  params?: SchemaRef;
  example?: unknown;
  title?: string;
  docs: Docs;
  origin: Origin;
  default?: ErrorRole;
}

/** A nature of the contract (ADR 0002 section 11). */
export interface NatureDecl {
  id: NatureId;
  base: NatureBase;
  docs: Docs;
  origin: Origin;
}

/** What an identity header carries (ADR 0002 section 9). */
export type HeaderSemantic =
  | "deadline"
  | "traceContext"
  | "actorSurface"
  | "versionToken"
  | (string & {});

/** The message a header travels in. */
export type HeaderSide = "request" | "response" | (string & {});

/** An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and 'request' for versionToken (invariant ir.header.members). */
export interface HeaderDecl {
  id: HeaderId;
  semantic: HeaderSemantic;
  name?: string;
  in?: HeaderSide;
  response?: string;
  request?: string;
  schema?: TypeUse;
  origin: Origin;
}

/** The key a signature is verified with: an id the application resolves to its secret, never the secret itself, written as a value or read from the request. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownSchemeKey = ValueSchemeKey | SourceSchemeKey;

/** The key a signature is verified with: an id the application resolves to its secret, never the secret itself, written as a value or read from the request. Must act: an unknown tag makes the IR invalid for every reader. */
export type SchemeKey = KnownSchemeKey | UnknownVariant<"kind">;

export interface ValueSchemeKey {
  kind: "value";
  /** The key id the application looks its secret up by; never the secret. */
  value: string;
}

export interface SourceSchemeKey {
  kind: "from";
  /** Where the request carries the key id (path, query or header). */
  from: ValueSource;
}

/** The OAuth 2 facts of a bearer scheme, for documents only. */
export interface OAuth2 {
  /** OpenAPI OAuth flows, copied as written. */
  flows: unknown;
}

/** Document-only facts of a bearer scheme. */
export interface BearerFacts {
  format?: string;
  oauth2?: OAuth2;
  openIdConnectUrl?: string;
}

/** How a signature is verified (ADR 0004 section 4). Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownSignatureVerify = TemplateSignature | ApplicationSignature;

/** How a signature is verified (ADR 0004 section 4). Must act: an unknown tag makes the IR invalid for every reader. */
export type SignatureVerify = KnownSignatureVerify | UnknownVariant<"verify">;

/** How a signature is encoded. */
export type SignatureEncoding = "hex" | "base64" | (string & {});

export interface TemplateSignature {
  verify: "template";
  format: string;
  algorithm: string;
  payload: string;
  encoding: SignatureEncoding;
  toleranceMs?: number;
  key: SchemeKey;
}

export interface ApplicationSignature {
  verify: "application";
  headers: string[];
  key?: SchemeKey;
}

/** A security scheme (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownScheme =
  | CookieScheme
  | HeaderScheme
  | QueryScheme
  | BearerScheme
  | BasicScheme
  | SignatureScheme;

/** A security scheme (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
export type Scheme = KnownScheme | UnknownVariant<"kind">;

/** A credential in a cookie; 'csrf' names the scheme that carries the CSRF token. */
export interface CookieScheme {
  id: SchemeId;
  kind: "cookie";
  /** The cookie name. */
  name: string;
  csrf?: SchemeId;
  origin: Origin;
}

/** A credential in a request header. */
export interface HeaderScheme {
  id: SchemeId;
  kind: "header";
  /** The header name. */
  name: string;
  origin: Origin;
}

/** A credential in a query parameter. */
export interface QueryScheme {
  id: SchemeId;
  kind: "query";
  /** The query parameter name. */
  name: string;
  origin: Origin;
}

/** A bearer token in the Authorization header. */
export interface BearerScheme {
  id: SchemeId;
  kind: "bearer";
  bearer?: BearerFacts;
  origin: Origin;
}

/** HTTP basic credentials in the Authorization header. */
export interface BasicScheme {
  id: SchemeId;
  kind: "basic";
  origin: Origin;
}

/** A signed request, verified as 'signature' says. */
export interface SignatureScheme {
  id: SchemeId;
  kind: "signature";
  /** The signature header. */
  name?: string;
  signature: SignatureVerify;
  origin: Origin;
}

/** The schemes of a credential identity. */
export interface CredentialSchemes {
  read: SchemeId[];
  /** Empty when the identity is refused on writes. */
  write: SchemeId[];
  optionalRead: SchemeId[];
}

/** The principal schema: one schema, or one per credential variant. */
export type KnownPrincipal = SchemaPrincipal | VariantsPrincipal;

/** The principal schema: one schema, or one per credential variant. */
export type Principal = KnownPrincipal | UnknownVariant<"kind">;

export interface SchemaPrincipal {
  kind: "schema";
  schema: SchemaRef;
}

export interface VariantsPrincipal {
  kind: "variants";
  variants: Record<VariantId, SchemaRef>;
}

/** Unknown keys of a signed identity's payload: ignored or kept, with the reason. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownKeysPolicy = IgnoreKeysPolicy | KeepKeysPolicy;

/** Unknown keys of a signed identity's payload: ignored or kept, with the reason. Must act: an unknown tag makes the IR invalid for every reader. */
export type KeysPolicy = KnownKeysPolicy | UnknownVariant<"policy">;

export interface IgnoreKeysPolicy {
  policy: "ignore";
  reason: Reason;
}

export interface KeepKeysPolicy {
  policy: "keep";
  reason: Reason;
}

/** The operations an identity header applies to. */
export type HeaderUseFor = "all" | "reads" | "writes" | (string & {});

/** A use of the headers catalogue by an identity. */
export interface IdentityHeaderUse {
  header: HeaderId;
  for: HeaderUseFor;
  required: boolean;
  schema?: TypeUse;
  from?: ValueSource;
  stale?: ErrorCode;
  origin: Origin;
}

/** An identity (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownIdentity = CredentialIdentity | SignedIdentity;

/** An identity (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
export type Identity = KnownIdentity | UnknownVariant<"kind">;

/** An identity reached through credential schemes. */
export interface CredentialIdentity {
  id: IdentityId;
  kind: "credential";
  schemes: CredentialSchemes;
  principal: Principal;
  errors: ErrorCode[];
  headers: IdentityHeaderUse[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** An identity reached through one signature scheme (ADR 0013). */
export interface SignedIdentity {
  id: IdentityId;
  kind: "signed";
  signed: SchemeId;
  principal: Principal;
  unknownKeys?: KeysPolicy;
  errors: ErrorCode[];
  headers: IdentityHeaderUse[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** The subject a right is checked against. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownRightSubject = NoSubject | ScopeSubject | ResourceSubject;

/** The subject a right is checked against. Must act: an unknown tag makes the IR invalid for every reader. */
export type RightSubject = KnownRightSubject | UnknownVariant<"kind">;

export interface NoSubject {
  kind: "none";
}

export interface ScopeSubject {
  kind: "scope";
  scope: ScopeId;
}

export interface ResourceSubject {
  kind: "resource";
  type: Name;
  idSchema: TypeUse;
}

/** A right (ADR 0004 section 4). */
export interface Right {
  id: RightId;
  params?: SchemaRef;
  subject: RightSubject;
  guest?: Reason;
  errors: ErrorCode[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
  derivedFrom?: DerivedFrom;
  codeName?: Name;
}

/** Where a rule proof is read. */
export type ProofPlacement = "body" | "header" | (string & {});

export interface RuleProof {
  in: ProofPlacement;
  name: string;
  schema: TypeUse;
}

/** A rule (ADR 0004 section 4). */
export interface Rule {
  id: RuleId;
  params?: SchemaRef;
  takesBucket: boolean;
  proof?: RuleProof;
  errors: ErrorCode[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** A scope (ADR 0004 section 4). */
export interface Scope {
  id: ScopeId;
  idSchema: TypeUse;
  within?: ScopeId;
  errors: ErrorCode[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** A rate-limit bucket (ADR 0004 section 4). */
export interface Bucket {
  id: BucketId;
  key: ValueSource[];
  limit?: number;
  windowMs?: number;
  origin: Origin;
}

/** An upstream service (ADR 0004 section 4). */
export interface Service {
  id: ServiceId;
  maturity: Maturity;
  origin: Origin;
}

/** Where an enum's values come from: a shared vocabulary or another enum. */
export type KnownEnumSource = VocabularyEnumSource | CatalogueEnumSource;

/** Where an enum's values come from: a shared vocabulary or another enum. */
export type EnumSource = KnownEnumSource | UnknownVariant<"kind">;

export interface VocabularyEnumSource {
  kind: "vocabulary";
  vocabulary: string;
}

export interface CatalogueEnumSource {
  kind: "enum";
  enum: EnumId;
}

/** An enum; values keep the written order (ADR 0004 section 4). */
export interface Enum {
  id: EnumId;
  name: Name;
  values: string[];
  /** Identifier override per value (ADR 0007). */
  codeNames?: Record<string, Name>;
  source?: EnumSource;
  localReason?: Reason;
  fallback?: string;
  directions: Direction[];
  docs: Docs;
  origin: Origin;
}

/** A named schema: objects, maps and unions are always named (ADR 0004 section 5). */
export type KnownSchema = ObjectSchema | MapSchema | UnionSchema;

/** A named schema: objects, maps and unions are always named (ADR 0004 section 5). */
export type Schema = KnownSchema | UnknownVariant<"kind">;

export interface ObjectSchema {
  kind: "object";
  properties: Property[];
  id: SchemaId;
  name: Name;
  typeName?: string;
  directions: Direction[];
  examples: unknown[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

export interface MapSchema {
  kind: "map";
  keys?: TypeUse;
  values: TypeUse;
  id: SchemaId;
  name: Name;
  typeName?: string;
  directions: Direction[];
  examples: unknown[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

export interface UnionSchema {
  kind: "union";
  tag: UnionTag;
  variants: UnionVariant[];
  id: SchemaId;
  name: Name;
  typeName?: string;
  directions: Direction[];
  examples: unknown[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** Where a union's tag is read; 'header' only for a route's whole input. */
export type KnownUnionTag = BodyUnionTag | HeaderUnionTag;

/** Where a union's tag is read; 'header' only for a route's whole input. */
export type UnionTag = KnownUnionTag | UnknownVariant<"in">;

export interface BodyUnionTag {
  in: "body";
  property: string;
}

export interface HeaderUnionTag {
  in: "header";
  name: string;
}

export interface UnionVariant {
  tag: string;
  schema: SchemaId;
}

/** An object property; the wire name stays 'name' (ADR 0004 section 5). */
export interface Property {
  name: string;
  type: TypeUse;
  optional: boolean;
  nullable: boolean;
  sensitive: boolean;
  restrictedTo?: FieldRestriction;
  default?: unknown;
  deprecated: boolean;
  codeName?: Name;
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
  derivedFrom?: DerivedFrom;
}

/** What the boundary does with a restricted input field sent without the right (A21). Must act: an unknown value makes the IR invalid for every reader. */
export type InputPolicy = "reject" | "strip" | (string & {});

/** A restrictedTo mark (ADR 0003 section 6). */
export interface FieldRestriction {
  right: RightId;
  params?: unknown;
  inputPolicy?: InputPolicy;
  origin?: Origin;
}

/** What a property, item, body or parameter is (ADR 0004 section 5). */
export type KnownTypeUse =
  | RefTypeUse
  | OpaqueTypeUse
  | FileTypeUse
  | EnumTypeUse
  | ScalarTypeUse
  | ArrayTypeUse;

/** What a property, item, body or parameter is (ADR 0004 section 5). */
export type TypeUse = KnownTypeUse | UnknownVariant<"kind">;

/** What an input use does with unknown keys (ADR 0003 section 4). Must act: an unknown value makes the IR invalid for every reader. */
export type UnknownKeysPolicy = "refuse" | "ignore" | "keep" | (string & {});

/** Unknown keys of an input use (ADR 0003 section 4). */
export interface UnknownKeys {
  policy: UnknownKeysPolicy;
  reason?: Reason;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

export interface RefTypeUse {
  kind: "ref";
  schema: SchemaId;
  unknownKeys?: UnknownKeys;
  /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
  nullable?: boolean;
}

/** Any JSON value, unchecked (ADR 0003 section 2). */
export interface OpaqueTypeUse {
  kind: "opaque";
  reason: Reason;
  origin: Origin;
}

/** A multipart field or a download (A39). */
export interface FileTypeUse {
  kind: "file";
  media: string[];
  maxSizeBytes?: number;
  /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
  nullable?: boolean;
}

export interface EnumNarrowing {
  values: string[];
  reason?: Reason;
}

export interface EnumTypeUse {
  kind: "enum";
  enum: EnumId;
  narrowedTo?: EnumNarrowing;
  /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
  nullable?: boolean;
}

/** The media type of a JSON text field. */
export type JsonMediaType = "application/json" | (string & {});

/** A form or multipart text field holding JSON. */
export interface JsonContent {
  media: JsonMediaType;
  schema: TypeUse;
}

/** The JSON type of a scalar. */
export type ScalarType = "string" | "integer" | "number" | "boolean" | (string & {});

/** A scalar use. A use of a named format names it in 'scalar' and holds its type and refinements inline, so a target that does not map the named format still checks it (ADR 0003 section 8). */
export interface ScalarTypeUse {
  kind: "scalar";
  type: ScalarType;
  /** A portable format of ADR 0003 section 8 ('uuid', 'int64', 'decimal'...); a named format is 'scalar'. */
  format?: string;
  /** The named format this use reads, from the scalars catalogue. */
  scalar?: ScalarId;
  refinements: Refinements;
  content?: JsonContent;
  /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
  nullable?: boolean;
}

export interface ArrayTypeUse {
  kind: "array";
  items: TypeUse;
  minItems?: number;
  maxItems?: number;
  /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
  nullable?: boolean;
}

/** A pattern refinement: the written text and its normalised form (ADR 0003 section 9). */
export interface Pattern {
  source: string;
  normalized: string;
}

/** A number written as a decimal literal string, so an int64 or decimal bound and a long multipleOf keep every digit in every language (ADR 0003 section 8). */
export type DecimalLiteral = string;

/** The refinements of a scalar (ADR 0003 sections 1 and 8); numeric ones are decimal literal strings, compared numerically. */
export interface Refinements {
  minLength?: number;
  maxLength?: number;
  pattern?: Pattern;
  minimum?: DecimalLiteral;
  maximum?: DecimalLiteral;
  exclusiveMinimum?: DecimalLiteral;
  exclusiveMaximum?: DecimalLiteral;
  multipleOf?: DecimalLiteral;
}

/** A named format of the scalars catalogue: a base type plus refinements (ADR 0003 section 8). Its own type holds no 'scalar'. */
export interface Scalar {
  id: ScalarId;
  name: Name;
  type: ScalarTypeUse;
  directions: Direction[];
  docs: Docs;
  origin: Origin;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | (string & {});

export type CallerKind = "anonymous" | "identified" | (string & {});

/** A kind-tagged operation reference (ADR 0014). */
export interface OperationRef {
  kind: DeclarationKind;
  api: string;
  id: OperationId;
}

/** How a query value is written (FR-30). */
export type QueryWireKind = "number" | "boolean" | "list" | "text" | "object" | (string & {});

/** The OpenAPI style of a query value. */
export type QueryStyle = "form" | "deepObject" | (string & {});

/** The wire form of a query parameter (FR-30). */
export interface QueryWire {
  kind: QueryWireKind;
  style: QueryStyle;
  explode: boolean;
  /** A list sent as 'name[]'. */
  brackets: boolean;
}

/** How a form or multipart field is written: a query wire kind, 'file' or 'json'. */
export type FieldWireKind =
  | "number"
  | "boolean"
  | "list"
  | "text"
  | "object"
  | "file"
  | "json"
  | (string & {});

/** The wire form of a form or multipart field: a query wire kind with style, explode and brackets, or kind 'file' or 'json' alone (invariant ir.field-wire.members). */
export interface FieldWire {
  kind: FieldWireKind;
  style?: QueryStyle;
  explode?: boolean;
  brackets?: boolean;
}

/** A path, query or header parameter, declared (origin) or derived (derivedFrom). */
export interface Param {
  name: string;
  type: TypeUse;
  required: boolean;
  wire?: QueryWire;
  default?: unknown;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

export interface Params {
  path: Param[];
  query: Param[];
  header: Param[];
}

/** Undeclared query keys. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownUnknownQuery = RefuseUnknownQuery | IgnoreUnknownQuery;

/** Undeclared query keys. Must act: an unknown tag makes the IR invalid for every reader. */
export type UnknownQuery = KnownUnknownQuery | UnknownVariant<"policy">;

export interface RefuseUnknownQuery {
  policy: "refuse";
}

export interface IgnoreUnknownQuery {
  policy: "ignore";
  reason: Reason;
  origin: Origin;
}

/** Who may call the operation. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownAccess = IdentityAccess | OptionalAccess | PublicAccess;

/** Who may call the operation. Must act: an unknown tag makes the IR invalid for every reader. */
export type Access = KnownAccess | UnknownVariant<"kind">;

export interface IdentityAccess {
  kind: "identity";
  identity: IdentityId;
  schemes: SchemeId[];
  origin: Origin;
}

/** What an optional-auth operation does with a refused credential: serve it as anonymous, or answer 401. Must act: an unknown value makes the IR invalid for every reader. */
export type RefusedCredential = "anonymous" | "reject" | (string & {});

export interface OptionalAccess {
  kind: "optional";
  identity: IdentityId;
  schemes: SchemeId[];
  reason: Reason;
  onRefused: RefusedCredential;
  origin: Origin;
}

export interface PublicAccess {
  kind: "public";
  reason: Reason;
  origin: Origin;
}

export interface PrincipalRequirement {
  field: string;
  origin: Origin;
}

export interface OperationScope {
  scope: ScopeId;
  /** Where the scope id is read; 'in: resolver' for an application resolver. */
  source: ValueSource;
  origin: Origin;
}

/** A requirement, in declared order (FR-5). Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownRequirement = RightRequirement | RuleRequirement;

/** A requirement, in declared order (FR-5). Must act: an unknown tag makes the IR invalid for every reader. */
export type Requirement = KnownRequirement | UnknownVariant<"kind">;

export interface RequirementSubject {
  source: ValueSource;
  defaulted: boolean;
}

export interface RightRequirement {
  kind: "right";
  right: RightId;
  /** Values already validated against the right's params schema. */
  params?: unknown;
  subject?: RequirementSubject;
  /** The 'requirements' entry it was written through. */
  entry?: string;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

export interface RuleRequirement {
  kind: "rule";
  rule: RuleId;
  /** Values already validated against the rule's params schema. */
  params?: unknown;
  bucket?: BucketId;
  /** The 'requirements' entry it was written through. */
  entry?: string;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

export interface Binding {
  from: ValueSource;
  to: ValueSource;
  origin: Origin;
}

export interface InputField {
  name: string;
  wire: FieldWire;
}

/** The media type of a request body. */
export type InputMediaType =
  | "application/json"
  | "application/x-www-form-urlencoded"
  | "multipart/form-data"
  | (string & {});

/** The request body. */
export interface OperationInput {
  media: InputMediaType;
  schema: TypeUse;
  bodyLimitBytes: number;
  rawBody: boolean;
  fields?: InputField[];
  /** The body fields of the rule proofs read in the body, each once, in requirement order; absent when there is none. Targets render the body as the input schema's properties followed by these fields. */
  proofs?: InputProof[];
  origin: Origin;
}

/** A body field the compiler adds to the input for a rule proof read in the body (derivation 'rule.proof'): required and sensitive (ADR 0002 section 9). A proof read in a header is a derived header parameter. */
export interface InputProof {
  name: string;
  schema: TypeUse;
  derivedFrom: DerivedFrom;
}

export interface ResponseHeader {
  name: string;
  type: TypeUse;
  required: boolean;
  semantic?: string;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

/** The format shape of a response; 'binary' and 'redirect' bypass the format (ADR 0004 section 8). */
export type ResponseShape =
  | "item"
  | "table"
  | "list"
  | "page"
  | "empty"
  | "binary"
  | "redirect"
  | (string & {});

/** A success or derived non-error response. */
export interface Response {
  status: number;
  /** Absent for an empty body. */
  media?: string;
  body?: TypeUse;
  shape: ResponseShape;
  headers: ResponseHeader[];
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

/** A code the operation can answer, declared or derived. */
export interface OperationError {
  code: ErrorCode;
  example?: unknown;
  derivedFrom?: DerivedFrom;
  origin?: Origin;
}

export interface FieldRightSubject {
  /** Where the subject is read; 'in: holderField' names the holder's property on output. */
  source: ValueSource;
}

/** A field right, materialised so targets never walk schemas (FR-23). */
export interface FieldRight {
  schema: SchemaId;
  pointer: string;
  right: RightId;
  params?: unknown;
  subject?: FieldRightSubject;
  direction: Direction;
  inputPolicy?: InputPolicy;
  derivedFrom: DerivedFrom;
}

/** The idempotency key of an unsafe operation: derived settings, or an exemption with its reason. Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownIdempotency = DerivedIdempotency | ExemptIdempotency;

/** The idempotency key of an unsafe operation: derived settings, or an exemption with its reason. Must act: an unknown tag makes the IR invalid for every reader. */
export type Idempotency = KnownIdempotency | UnknownVariant<"kind">;

/** Where the idempotency key is enforced. */
export type IdempotencyEnforcement = "boundary" | "none" | (string & {});

export interface DerivedIdempotency {
  kind: "derived";
  header: string;
  replayHeader: string;
  lifetimeMs: number;
  required: boolean;
  enforce: IdempotencyEnforcement;
  derivedFrom: DerivedFrom;
}

export interface ExemptIdempotency {
  kind: "exempt";
  reason: Reason;
  origin: Origin;
}

export interface Concurrency {
  version: ValueSource;
  field: string;
  derivedFrom: DerivedFrom;
}

/** Who owns the resource an operation writes. */
export type OwnerKind = "caller" | (string & {});

export interface Owner {
  kind: OwnerKind;
  origin: Origin;
}

export interface CacheDirectives {
  maxAgeMs: number;
  sharedMaxAgeMs?: number;
  staleWhileRevalidateMs?: number;
  staleIfErrorMs?: number;
  immutable: boolean;
  noCache: boolean;
  mustRevalidate: boolean;
}

export interface CallerCacheControl {
  caller: CallerKind;
  cacheControl: string;
}

/** Whether a shared cache may store an anonymous response. */
export type CacheVisibility = "public" | "private" | (string & {});

/** Cache settings (ADR 0004 section 7). */
export interface Cache {
  family: string;
  /** Absent if and only if the family is 'never' (invariant ir.cache.directives). */
  directives?: CacheDirectives;
  anonymous: CacheVisibility;
  vary: string[];
  etag: boolean;
  perCallerKind: CallerCacheControl[];
  /** Authoritative: when true the response is never stored, whatever 'directives' hold. True when the family is 'never' or a response carries a sensitive field (ADR 0003 section 6). */
  noStore: boolean;
  origin: Origin;
  derivedFrom?: DerivedFrom;
}

export interface SortKey {
  key: string;
  right?: RightId;
  derivedFrom?: DerivedFrom;
  origin?: Origin;
}

/** What a limit above maxLimit does. */
export type OverLimitPolicy = "reject" | "clamp" | (string & {});

/** What a paging token holds. */
export type PagingToken = "opaque" | "instant" | (string & {});

/** The paging of a list; 'style' is absent for an unpaged list. */
export interface Paging {
  style?: PagingId;
  maxLimit?: number;
  defaultLimit?: number;
  overLimit: OverLimitPolicy;
  token?: PagingToken;
  sortKeys: SortKey[];
  origin: Origin;
}

/** The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with its reason (invariant ir.csrf.cookie). Must act: an unknown tag makes the IR invalid for every reader. */
export type KnownCsrf = DerivedCsrf | ExemptCsrf;

/** The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with its reason (invariant ir.csrf.cookie). Must act: an unknown tag makes the IR invalid for every reader. */
export type Csrf = KnownCsrf | UnknownVariant<"kind">;

export interface DerivedCsrf {
  kind: "derived";
  header: string;
  derivedFrom: DerivedFrom;
}

export interface ExemptCsrf {
  kind: "exempt";
  reason: Reason;
  origin: Origin;
}

export interface Degradable {
  paths: string[];
  origin: Origin;
}

export interface Deprecation {
  sunset: string;
  successor?: OperationRef;
  origin: Origin;
}

/** Where an operation's maturity comes from. */
export type MaturitySource = "api" | "upstream" | "stated" | (string & {});

export interface OperationMaturity {
  level: Maturity;
  source: MaturitySource;
  reason?: Reason;
  origin: Origin;
}

/** The collection or single it belongs to. */
export interface OperationResource {
  type: string;
  idParam?: string;
  idProperty?: string;
}

/** A route example; with 'error', 'value' holds the code's params. */
export interface OperationExample {
  status?: number;
  request?: boolean;
  error?: ErrorCode;
  value: unknown;
}

/** The ops shorthand an operation came from. */
export type OpShorthand = "list" | "get" | "create" | "update" | "delete" | "batch" | (string & {});

/** An HTTP operation (ADR 0004 section 7). */
export interface Operation {
  kind: DeclarationKind;
  id: OperationId;
  name: Name;
  surface: SurfaceId;
  op?: OpShorthand;
  resource?: OperationResource;
  features: Feature[];
  method: HttpMethod;
  path: string;
  safe: boolean;
  params: Params;
  unknownQuery: UnknownQuery;
  access: Access;
  callerKinds: CallerKind[];
  principalRequires: PrincipalRequirement[];
  scopes: OperationScope[];
  requires: Requirement[];
  bindings: Binding[];
  input?: OperationInput;
  responses: Response[];
  errors: OperationError[];
  fieldRights: FieldRight[];
  idempotency?: Idempotency;
  concurrency?: Concurrency;
  owner?: Owner;
  cache?: Cache;
  paging?: Paging;
  filteredBy?: RightId;
  degradable?: Degradable;
  budgetMs?: number;
  deadlineHeader?: string;
  deprecated?: Deprecation;
  relays?: OperationRef;
  upstream: ServiceId[];
  maturity: OperationMaturity;
  internal: boolean;
  csrf?: Csrf;
  format: FormatId;
  tags: string[];
  examples: Record<string, OperationExample>;
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** A slot of the template language (ADR 0002 sections 13 and 14), without its '$'. */
export type Slot = string;

export type UrlRole = "self" | "first" | "previous" | "next" | "last" | (string & {});

export type Absent = "omit" | "null" | (string & {});

export interface HeaderTemplate {
  name: string;
  value: Template;
}

export interface Shape {
  body: Template;
  headers: HeaderTemplate[];
}

export interface SuccessShapes {
  item: Shape;
  table: Shape;
  list: Shape;
  page: Shape;
}

/** Who fills a $meta member; 'source' reads the member 'source'. */
export type MetaFill = "now" | "traceId" | "degraded" | "handler" | "source" | (string & {});

/** A member of the format's $meta: 'source' set if and only if 'fill' is 'source' (invariant ir.meta.source). */
export interface MetaMember {
  type: TypeUse;
  fill: MetaFill;
  source?: ValueSource;
}

export interface ErrorShape {
  media: string;
  body: Template;
  headers: HeaderTemplate[];
}

/** A wire format (A30, ADR 0008). */
export interface WireFormat {
  id: FormatId;
  origin: Origin;
  media: string;
  absent: Absent;
  success: SuccessShapes;
  meta: Record<string, MetaMember>;
  error: ErrorShape;
}

/** The role of a paging request parameter. */
export type PagingRole =
  | "cursor"
  | "after"
  | "before"
  | "page"
  | "offset"
  | "since"
  | "limit"
  | "sort"
  | (string & {});

/** Where a paging request parameter is read. */
export type PagingParamPlacement = "query" | "header" | (string & {});

/** How a sort parameter is written. */
export type PagingParamStyle = "signed" | "pair" | "keyed" | "split" | (string & {});

export interface PagingRequestRole {
  role: PagingRole;
  in: PagingParamPlacement;
  name: string;
  base?: number;
  style?: PagingParamStyle;
  /** With style 'split': the direction parameter's name. */
  direction?: string;
}

export interface NamedTemplate {
  name: string;
  value: Template;
}

export interface PagingLink {
  rel: string;
  role: UrlRole;
}

export interface PagingResponse {
  /** The whole page body; absent when the style adds 'meta' to the format's page. */
  body?: Template;
  meta: NamedTemplate[];
  headers: HeaderTemplate[];
  links: PagingLink[];
}

/** How a paging style positions a page. */
export type PagingPosition = "cursor" | "page" | "offset" | "since" | (string & {});

/** What a handler returns beside a page's items. */
export type HandlerResultMember =
  | "nextCursor"
  | "previousCursor"
  | "total"
  | "more"
  | "nextSince"
  | "complete"
  | (string & {});

/** A paging style (A31). */
export interface PagingStyle {
  id: PagingId;
  origin: Origin;
  position: PagingPosition;
  absent: Absent;
  request: PagingRequestRole[];
  response: PagingResponse;
  handlerResult: HandlerResultMember[];
}

/** A template of the template language (ADR 0002 sections 13 and 14). */
export type KnownTemplate =
  | SlotTemplate
  | TextTemplate
  | LiteralTemplate
  | ObjectTemplate
  | ArrayTemplate
  | EachTemplate;

/** A template of the template language (ADR 0002 sections 13 and 14). */
export type Template = KnownTemplate | UnknownVariant<"kind">;

export interface SlotTemplate {
  kind: "slot";
  slot: Slot;
  path: string[];
}

/** A part of a text template: literal text, or a slot with its path. */
export type KnownTextPart = PlainTextPart | SlotTextPart;

/** A part of a text template: literal text, or a slot with its path. */
export type TextPart = KnownTextPart | UnknownVariant<"kind">;

export interface PlainTextPart {
  kind: "text";
  text: string;
}

export interface SlotTextPart {
  kind: "slot";
  slot: Slot;
  path: string[];
}

export interface TextTemplate {
  kind: "text";
  parts: TextPart[];
}

export interface LiteralTemplate {
  kind: "literal";
  value: unknown;
}

/** The name of an object template member: literal text, or a slot. */
export type KnownMemberName = PlainMemberName | SlotMemberName;

/** The name of an object template member: literal text, or a slot. */
export type MemberName = KnownMemberName | UnknownVariant<"kind">;

export interface PlainMemberName {
  kind: "text";
  text: string;
}

export interface SlotMemberName {
  kind: "slot";
  slot: Slot;
}

export interface ObjectTemplateMember {
  name: MemberName;
  value: Template;
}

export interface ObjectTemplate {
  kind: "object";
  members: ObjectTemplateMember[];
  merge?: Slot;
}

export interface ArrayTemplate {
  kind: "array";
  items: Template[];
}

export interface EachTemplate {
  kind: "each";
  of: Slot;
  as: Template;
}

/** One IR document per api (ADR 0004 sections 1 and 2). */
export interface ContractIR {
  /** 1 until 1.0 and through 1.x (ADR 0005 section 2). */
  irVersion: number;
  /** Rises by one with every IR change (ADR 0005 section 2). */
  irRevision: number;
  kinds: DeclarationKind[];
  features: Feature[];
  api: Api;
  packs: PackRef[];
  conventions: Conventions;
  formats: Record<FormatId, WireFormat>;
  pagings: Record<PagingId, PagingStyle>;
  schemas: Record<SchemaId, Schema>;
  scalars: Record<ScalarId, Scalar>;
  enums: Record<EnumId, Enum>;
  errors: Record<ErrorCode, ErrorDecl>;
  natures: Record<NatureId, NatureDecl>;
  schemes: Record<SchemeId, Scheme>;
  headers: Record<HeaderId, HeaderDecl>;
  identities: Record<IdentityId, Identity>;
  rights: Record<RightId, Right>;
  rules: Record<RuleId, Rule>;
  scopes: Record<ScopeId, Scope>;
  buckets: Record<BucketId, Bucket>;
  services: Record<ServiceId, Service>;
  extensionKeys: Record<ExtensionKeyId, ExtensionKeyDecl>;
  lint: Lint;
  operations: Operation[];
}

/** A pack applied, in application order. */
export interface PackRef {
  name: string;
  version: string;
}

/** Whether paths carry the version prefix. */
export type PathVersionMode = "prefix" | "none" | (string & {});

export interface Surface {
  name: Name;
  prefix: string;
  pathVersion: PathVersionMode;
  origin: Origin;
}

/** Whether a document lists internal operations. */
export type InternalPolicy = "include" | "exclude" | (string & {});

export interface ApiDocument {
  surfaces: SurfaceId[];
  internal: InternalPolicy;
}

export interface PathVersion {
  value: PathVersionMode;
  origin: Origin;
}

export interface ApiCaller {
  identity: IdentityId;
  right: RightId;
}

/** The api version: the path version number, or a label when every surface's pathVersion is 'none'. */
export type KnownApiVersion = PathApiVersion | LabelApiVersion;

/** The api version: the path version number, or a label when every surface's pathVersion is 'none'. */
export type ApiVersion = KnownApiVersion | UnknownVariant<"kind">;

export interface PathApiVersion {
  kind: "path";
  /** The number paths carry ('/v1'). */
  number: number;
}

export interface LabelApiVersion {
  kind: "label";
  label: string;
}

/** A product api or a service api. */
export type ApiKind = "product" | "service" | (string & {});

/** The role of an api. */
export type ApiRole = "gateway" | (string & {});

/** The compatibility policy the diff checks. */
export type CompatPolicy = "additive-only" | "none" | (string & {});

export interface Compat {
  policy: CompatPolicy;
}

/** The api (ADR 0004 section 2). */
export interface Api {
  id: string;
  name: Name;
  version: ApiVersion;
  kind: ApiKind;
  pathVersion: PathVersion;
  role?: ApiRole;
  maturity: Maturity;
  caller?: ApiCaller;
  compat: Compat;
  surfaces: Record<SurfaceId, Surface>;
  documents: Record<DocumentId, ApiDocument>;
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** A resolved convention value with the origin of the node that set it. */
export interface ConventionValue {
  value: unknown;
  origin: Origin;
}

/** Resolved conventions, keyed by the dotted path of the convention under 'conventions' (for example 'pathVersion', 'idempotency.header'). Informative only: provenance for explain and lint. A target never acts on a convention; every convention a target acts on is a typed member (ADR 0004 section 13). */
export type Conventions = Record<string, ConventionValue>;

/** Where an extension key may appear (ADR 0002 section 12). */
export type ExtensionPlace =
  | "api"
  | "operation"
  | "schema"
  | "property"
  | "right"
  | "rule"
  | "scope"
  | (string & {});

/** A declared extension key (ADR 0002 section 12). */
export interface ExtensionKeyDecl {
  id: ExtensionKeyId;
  prefix: ExtensionPrefix;
  key: ExtensionKey;
  schema: TypeUse;
  places: ExtensionPlace[];
  origin: Origin;
}

/** A lint severity. */
export type LintSeverity = "disabled" | "warning" | "error" | (string & {});

/** A resolved lint severity. */
export interface LintRule {
  severity: LintSeverity;
  origin: Origin;
}

/** An allow of ADR 0002 section 12. */
export interface LintAllow {
  rule: string;
  at: Origin;
  reason: Reason;
  subtree: boolean;
}

export interface Lint {
  rules: Record<string, LintRule>;
  allows: LintAllow[];
}

export interface SourceMap {
  irRevision: number;
  /** Keyed by '<layer>#<pointer>', the serialised form of an Origin; a 'core' origin has no entry (ADR 0004 section 11). */
  locations: Record<string, SourceLocation>;
}

/** A location in a source file. */
export interface SourceLocation {
  /** Relative to the workspace root, with forward slashes: never absolute, no '.' or '..' segment, no backslash or ':'. */
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Every tagged union of the IR, for `isKnownVariant`. */
export interface IrUnionMap {
  SchemeKey: { union: SchemeKey; known: KnownSchemeKey };
  SignatureVerify: { union: SignatureVerify; known: KnownSignatureVerify };
  Scheme: { union: Scheme; known: KnownScheme };
  Principal: { union: Principal; known: KnownPrincipal };
  KeysPolicy: { union: KeysPolicy; known: KnownKeysPolicy };
  Identity: { union: Identity; known: KnownIdentity };
  RightSubject: { union: RightSubject; known: KnownRightSubject };
  EnumSource: { union: EnumSource; known: KnownEnumSource };
  Schema: { union: Schema; known: KnownSchema };
  UnionTag: { union: UnionTag; known: KnownUnionTag };
  TypeUse: { union: TypeUse; known: KnownTypeUse };
  UnknownQuery: { union: UnknownQuery; known: KnownUnknownQuery };
  Access: { union: Access; known: KnownAccess };
  Requirement: { union: Requirement; known: KnownRequirement };
  Idempotency: { union: Idempotency; known: KnownIdempotency };
  Csrf: { union: Csrf; known: KnownCsrf };
  Template: { union: Template; known: KnownTemplate };
  TextPart: { union: TextPart; known: KnownTextPart };
  MemberName: { union: MemberName; known: KnownMemberName };
  ApiVersion: { union: ApiVersion; known: KnownApiVersion };
}
