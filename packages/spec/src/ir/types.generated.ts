// Generated from packages/spec/schemas/ir/*.schema.json by src/ir/generate-types.ts. Do not edit.
// Regenerate: UPDATE_IR_TYPES=1 pnpm vitest run packages/spec/src/ir/types.test.ts

/** The id of a named schema: its catalogue key (ADR 0004 section 9). */
export type SchemaId = string;

/** The id of a named scalar: its catalogue key (ADR 0004 section 9). */
export type ScalarId = string;

/** The id of an enum: its catalogue key (ADR 0004 section 9). */
export type EnumId = string;

/** An error code, the key of the errors catalogue (ADR 0004 section 4). */
export type ErrorCode = string;

/** The id of a contract nature: its catalogue key (ADR 0004 section 9). */
export type NatureId = string;

/** The id of a security scheme: its catalogue key (ADR 0004 section 9). */
export type SchemeId = string;

/** The id of an identity header: its catalogue key (ADR 0004 section 9). */
export type HeaderId = string;

/** The id of an identity: its catalogue key (ADR 0004 section 9). */
export type IdentityId = string;

/** The id of a right: its catalogue key (ADR 0004 section 9). */
export type RightId = string;

/** The id of a rule: its catalogue key (ADR 0004 section 9). */
export type RuleId = string;

/** The id of a scope: its catalogue key (ADR 0004 section 9). */
export type ScopeId = string;

/** The id of a rate-limit bucket: its catalogue key (ADR 0004 section 9). */
export type BucketId = string;

/** The id of a service: its catalogue key (ADR 0004 section 9). */
export type ServiceId = string;

/** An extension key, written '<prefix>-<key>' (ADR 0002 section 12). */
export type ExtensionKeyId = string;

/** The id of a wire format: its catalogue key (ADR 0004 section 9). */
export type FormatId = string;

/** The id of a paging style: its catalogue key (ADR 0004 section 9). */
export type PagingId = string;

/** The id of an api surface: its catalogue key (ADR 0004 section 9). */
export type SurfaceId = string;

/** The id of an api document: its catalogue key (ADR 0004 section 9). */
export type DocumentId = string;

/** The id of a principal variant: its catalogue key (ADR 0004 section 9). */
export type VariantId = string;

/** An operation id (ADR 0004 section 7). */
export type OperationId = string;

/** A derivation id of the derivation table (ADR 0006 section 5), 'pack.<pack>.<entry>' for a pack entry. */
export type DerivationId = string;

/** A must-understand feature name (ADR 0005 section 3); none is defined at irRevision 1. */
export type Feature = string;

/** The written reason of an exception (A36). */
export type Reason = string;

/** A reference by id to a named object schema of the schemas catalogue (ADR 0004 section 4). */
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

/** A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1). */
export interface Name {
  segments: string[];
  role: NameRole;
  /** The HTTP success status of a 'response' name; present if and only if role is 'response' (lead decision, checked by the compiler: the schema subset has no conditional). */
  status?: number;
}

/** Resolved documentation text. */
export interface Docs {
  summary?: string;
  description?: string;
}

/** The extension slot: { '<prefix>': { '<key>': value } } (ADR 0004 section 3). */
export type Extensions = Record<string, Record<string, unknown>>;

/** Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section 6). */
export interface Origin {
  /** Set on an element copied from another api by a relay route. */
  api?: string;
  /** 'api', 'shared', 'base' or 'pack:<name>'. */
  layer: "api" | "shared" | "base" | `pack:${string}`;
  pointer: string;
}

/** Present on, and only on, an element the compiler derived (ADR 0004 section 6). */
export interface DerivedFrom {
  derivation: DerivationId;
  from: Origin[];
}

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
  | (string & {});

/** Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal and scope; 'prefixBits' only with address. */
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

/** An error code of the registry (ADR 0004 section 4). */
export interface ErrorDecl {
  code: ErrorCode;
  /** The declared family, or the code up to its first dot. */
  family?: string;
  nature: NatureBase;
  natureName?: NatureId;
  http: {
    status: number;
  };
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

/** An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and 'request' for versionToken. */
export interface HeaderDecl {
  id: HeaderId;
  semantic: "deadline" | "traceContext" | "actorSurface" | "versionToken" | (string & {});
  name?: string;
  in?: "request" | "response" | (string & {});
  response?: string;
  request?: string;
  schema?: TypeUse;
  origin: Origin;
}

/** A signing key: exactly one of 'value' or 'from'. */
export interface SchemeKey {
  value?: string;
  from?: ValueSource;
}

/** Document-only facts of a bearer scheme. */
export interface BearerScheme {
  format?: string;
  oauth2?: {
    /** OpenAPI OAuth flows, copied as written. */
    flows: unknown;
  };
  openIdConnectUrl?: string;
}

/** How a signature is verified (ADR 0004 section 4). */
export type SignatureScheme = TemplateSignature | ApplicationSignature;

export interface TemplateSignature {
  verify: "template";
  format: string;
  algorithm: string;
  payload: string;
  encoding: "hex" | "base64" | (string & {});
  toleranceMs?: number;
  key: SchemeKey;
}

export interface ApplicationSignature {
  verify: "application";
  headers: string[];
  key?: SchemeKey;
}

/** A security scheme (ADR 0004 section 4). */
export interface Scheme {
  id: SchemeId;
  kind: "cookie" | "header" | "query" | "bearer" | "basic" | "signature" | (string & {});
  /** The cookie, header or query parameter, or the signature header. */
  name?: string;
  csrf?: SchemeId;
  bearer?: BearerScheme;
  signature?: SignatureScheme;
  origin: Origin;
}

/** The schemes of an identity: read, write and optionalRead for a credential identity, signed for a signed one. */
export interface IdentitySchemes {
  read?: SchemeId[];
  write?: SchemeId[];
  optionalRead?: SchemeId[];
  signed?: SchemeId;
}

/** The principal schema: exactly one of 'schema' or 'variants'. */
export interface Principal {
  schema?: SchemaRef;
  variants?: Record<VariantId, SchemaRef>;
}

/** Unknown keys of a signed identity: exactly one of 'ignore' or 'keep'. */
export interface KeysPolicy {
  ignore?: Reason;
  keep?: Reason;
}

/** A use of the headers catalogue by an identity. */
export interface IdentityHeaderUse {
  header: HeaderId;
  for: "all" | "reads" | "writes" | (string & {});
  required: boolean;
  schema?: TypeUse;
  from?: ValueSource;
  stale?: ErrorCode;
  origin: Origin;
}

/** An identity (ADR 0004 section 4). */
export interface Identity {
  id: IdentityId;
  kind: "credential" | "signed" | (string & {});
  schemes: IdentitySchemes;
  principal: Principal;
  unknownKeys?: KeysPolicy;
  errors: ErrorCode[];
  headers: IdentityHeaderUse[];
  docs: Docs;
  extensions: Extensions;
  origin: Origin;
}

/** The subject a right is checked against. */
export type RightSubject = NoSubject | ScopeSubject | ResourceSubject;

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
  idSchema: SchemaRef;
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

export interface RuleProof {
  in: "body" | "header" | (string & {});
  name: string;
  schema: SchemaRef;
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
  idSchema: SchemaRef;
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

/** Where an enum's values come from: exactly one of 'vocabulary' or 'enum'. */
export interface EnumSource {
  vocabulary?: string;
  enum?: EnumId;
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
export type Schema = ObjectSchema | MapSchema | UnionSchema;

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
export type UnionTag = BodyUnionTag | HeaderUnionTag;

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

/** A restrictedTo mark (ADR 0003 section 6). */
export interface FieldRestriction {
  right: RightId;
  params?: unknown;
  inputPolicy?: "reject" | "strip" | (string & {});
  origin?: Origin;
}

/** What a property, item, body or parameter is (ADR 0004 section 5). */
export type TypeUse =
  | RefTypeUse
  | OpaqueTypeUse
  | FileTypeUse
  | EnumTypeUse
  | ScalarTypeUse
  | ArrayTypeUse;

/** Unknown keys of an input use (ADR 0003 section 4). */
export interface UnknownKeys {
  policy: "refuse" | "ignore" | "keep" | (string & {});
  reason?: Reason;
  origin?: Origin;
  derivedFrom?: DerivedFrom;
}

export interface RefTypeUse {
  kind: "ref";
  schema: SchemaId;
  unknownKeys?: UnknownKeys;
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
}

export interface EnumNarrowing {
  values: string[];
  reason?: Reason;
}

export interface EnumTypeUse {
  kind: "enum";
  enum: EnumId;
  narrowedTo?: EnumNarrowing;
}

/** A form or multipart text field holding JSON. */
export interface JsonContent {
  media: "application/json" | (string & {});
  schema: TypeUse;
}

export interface ScalarTypeUse {
  kind: "scalar";
  type: "string" | "integer" | "number" | "boolean" | (string & {});
  format?: string;
  refinements: Refinements;
  content?: JsonContent;
}

export interface ArrayTypeUse {
  kind: "array";
  items: TypeUse;
  minItems?: number;
  maxItems?: number;
}

/** A pattern refinement: the written text and its normalised form (ADR 0003 section 9). */
export interface Pattern {
  source: string;
  normalized: string;
}

/** The refinements of a scalar (ADR 0003 sections 1 and 8). */
export interface Refinements {
  minLength?: number;
  maxLength?: number;
  pattern?: Pattern;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

/** A named scalar of the scalars catalogue. */
export interface Scalar {
  id: ScalarId;
  name: Name;
  type: ScalarTypeUse;
  directions: Direction[];
  docs: Docs;
  origin: Origin;
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
}

/** A pack applied, in application order. */
export interface PackRef {
  name: string;
  version: string;
}

export interface Surface {
  name: Name;
  prefix: string;
  pathVersion: "prefix" | "none" | (string & {});
  origin: Origin;
}

export interface ApiDocument {
  surfaces: SurfaceId[];
  internal: "include" | "exclude" | (string & {});
}

export interface PathVersion {
  value: "prefix" | "none" | (string & {});
  origin: Origin;
}

export interface ApiCaller {
  identity: IdentityId;
  right: RightId;
}

/** The api (ADR 0004 section 2). */
export interface Api {
  id: string;
  name: Name;
  /** The path version as an integer, or a string only when every surface's pathVersion is 'none'. */
  version: unknown;
  kind: "product" | "service" | (string & {});
  pathVersion: PathVersion;
  role?: "gateway" | (string & {});
  maturity: Maturity;
  caller?: ApiCaller;
  compat: {
    policy: "additive-only" | "none" | (string & {});
  };
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

/** Resolved conventions, keyed by the dotted path of the convention under 'conventions' (for example 'pathVersion', 'idempotency.header'). */
export type Conventions = Record<string, ConventionValue>;

/** A declared extension key (ADR 0002 section 12). */
export interface ExtensionKeyDecl {
  id: ExtensionKeyId;
  prefix: string;
  key: string;
  schema: TypeUse;
  places: string[];
  origin: Origin;
}

/** A resolved lint severity. */
export interface LintRule {
  severity: "disabled" | "warning" | "error" | (string & {});
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
  /** Keyed by '<layer>#<pointer>', the serialised form of an Origin. */
  locations: Record<string, SourceLocation>;
}

/** A location; 'file' is relative to the workspace root, with forward slashes. */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
