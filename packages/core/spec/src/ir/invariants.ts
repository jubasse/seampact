import { isIrCalendarDate } from "./calendar-date.js";
import {
  type IrInstanceNode,
  irDefinition,
  KNOWN_VALUES_KEYWORD,
  walkIrInstance,
} from "./instance-walk.js";
import type { SchemaNode } from "./schemas.js";
import { isIrSameTypeUse } from "./type-use.js";
import { irUnionTags } from "./unions.js";

// The cross-member rules of the IR that the ADR 0003 subset cannot state (no conditional keyword), by stable
// id. README.md lists them; p2-finalize runs `checkIrInvariants` after the strict form, and native readers'
// tests reuse it. A rule decided by an open-enum value applies to known values only (the known list read from
// the schema's `x-seampact-known`): an unknown tag or value is the reader's to name.
export type IrInvariantId =
  | "ir.name.status"
  | "ir.meta.source"
  | "ir.value-source.members"
  | "ir.value-source.place"
  | "ir.header.members"
  | "ir.cache.directives"
  | "ir.cache.sensitive-no-store"
  | "ir.csrf.cookie"
  | "ir.field-wire.members"
  | "ir.property.nullable"
  | "ir.scalar.type"
  | "ir.id.scalar"
  | "ir.ref.resolves"
  | "ir.origin.core"
  | "ir.input-proof.wire"
  | "ir.input-proof.name"
  | "ir.input-proof.input"
  | "ir.field-right.always"
  | "ir.sort-key.right"
  | "ir.value.exact-number"
  | "ir.degradable.header"
  | "ir.deprecation.headers"
  | "ir.deprecation.since"
  | "ir.operation.role-once"
  | "ir.error.role-params"
  | "ir.error.retry-header";

export interface IrInvariantViolation {
  id: IrInvariantId;
  pointer: string; // the object that breaks the rule
  message: string;
}

type Json = Record<string, unknown>;

const has = (value: Json, member: string): boolean =>
  Object.hasOwn(value, member) && value[member] !== undefined;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const parentOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf("/"));
const unescapeSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

// The hand-written partitions of the values that decide a struct's members, listed in `IR_PARTITIONS` below. Each
// must be a disjoint union of the schema's known list: invariants.test.ts asserts it, so a new known value fails
// there until its invariant decides it (CHANGE-TEMPLATE.md).
const NAMED_SOURCES = ["path", "query", "header", "body", "principal", "scope", "holderField"];
const BARE_SOURCES = ["host", "subdomain", "resolver", "address"];
const QUERY_WIRE_KINDS = ["number", "boolean", "list", "text", "object"];
const PLAIN_WIRE_KINDS = ["file", "json"];
const QUERY_WIRE_MEMBERS = ["style", "explode", "brackets"];
const ID_TYPE_KINDS = ["scalar", "enum"]; // an id is a scalar or an enum use
const PROOF_REFUSED_KINDS = ["opaque", "file"]; // a proof is anything else
const OTHER_TYPE_KINDS = ["ref", "array"]; // neither an id nor a refused proof
const KNOWN_TYPE_USE_KINDS = [...ID_TYPE_KINDS, ...PROOF_REFUSED_KINDS, ...OTHER_TYPE_KINDS];
// The known schema kinds, object and not: a body proof is a property beside the input's own, so its input is
// an object schema.
const OBJECT_SCHEMA_KINDS = ["object"];
const NON_OBJECT_SCHEMA_KINDS = ["map", "union"];
const KNOWN_SCHEMA_KINDS = [...OBJECT_SCHEMA_KINDS, ...NON_OBJECT_SCHEMA_KINDS];
// The input media whose body is a list of fields, each with a wire form (`fields`, a proof's `wire`), and the rest.
const FIELD_MEDIA = ["application/x-www-form-urlencoded", "multipart/form-data"];
const DOCUMENT_MEDIA = ["application/json"];
// The catalogues of the declarations the compiler supplies (origin layer `core`, ADR 0004 sections 6 and 13).
const CORE_CATALOGUES = ["formats", "errors", "schemas"];

export const IR_PARTITIONS = {
  "ValueSource.in": [NAMED_SOURCES, BARE_SOURCES],
  "FieldWire.kind": [QUERY_WIRE_KINDS, PLAIN_WIRE_KINDS],
  "TypeUse.kind": [ID_TYPE_KINDS, PROOF_REFUSED_KINDS, OTHER_TYPE_KINDS],
  "OperationInput.media": [FIELD_MEDIA, DOCUMENT_MEDIA],
  "Schema.kind": [OBJECT_SCHEMA_KINDS, NON_OBJECT_SCHEMA_KINDS],
} as const satisfies Record<string, readonly (readonly string[])[]>;

// The known values of the open enum that `definition.member` references, read from the schema files.
function knownValues(definition: string, member: string): readonly string[] {
  const properties = irDefinition(definition)?.properties as Record<string, SchemaNode> | undefined;
  let node =
    properties !== undefined && Object.hasOwn(properties, member) ? properties[member] : undefined;

  while (typeof node?.$ref === "string")
    node = irDefinition(node.$ref.slice(node.$ref.lastIndexOf("/") + 1));
  const known = node?.[KNOWN_VALUES_KEYWORD];

  if (!Array.isArray(known)) throw new Error(`${definition}.${member} is not an open enum`);

  return known as string[];
}

const isKnown = (definition: string, member: string, value: unknown): boolean =>
  typeof value === "string" && knownValues(definition, member).includes(value);

// The catalogues an id names, by the id definition that keys them: every map of the top level and of the api
// whose keys are a `$ref` to an id definition (`schemes` keyed by `SchemeId`, `surfaces` by `SurfaceId`).
const CATALOGUES = new Map<string, { owner: "ContractIR" | "Api"; member: string }>();

for (const owner of ["ContractIR", "Api"] as const) {
  const properties = irDefinition(owner)?.properties as Record<string, SchemaNode> | undefined;

  for (const [member, schema] of Object.entries(properties ?? {})) {
    const keys = schema.propertyNames as SchemaNode | undefined;

    if (typeof keys?.$ref === "string")
      CATALOGUES.set(keys.$ref.slice(keys.$ref.lastIndexOf("/") + 1), { owner, member });
  }
}

type Fail = (id: IrInvariantId, pointer: string, message: string) => void;

const proofsOf = (input: Json): unknown[] => (Array.isArray(input.proofs) ? input.proofs : []);

// The schema entry a `ref` use names, if the document has it.
function refTargetOf(use: Json, schemaEntries: Json): unknown {
  if (use.kind !== "ref" || typeof use.schema !== "string") return undefined;

  return Object.hasOwn(schemaEntries, use.schema) ? schemaEntries[use.schema] : undefined;
}

// The input of a body proof is a `ref` use of an object schema (`ApiEmptyBody` for a proof-only input). An
// unknown use or schema kind is the reader's to name, and a missing schema is ir.ref.resolves'.
function checkProofInput(input: Json, pointer: string, schemaEntries: Json, fail: Fail): void {
  if (proofsOf(input).length === 0) return;
  const use = isRecord(input.schema) ? input.schema : {};
  const message = "An input with body proofs is a 'ref' use of an object schema";

  if (use.kind !== "ref") {
    if (KNOWN_TYPE_USE_KINDS.includes(String(use.kind)))
      fail("ir.input-proof.input", `${pointer}/schema`, `${message}, not a '${use.kind}' use.`);

    return;
  }

  const target = refTargetOf(use, schemaEntries);

  if (!isRecord(target)) return;
  const kind = String(target.kind);

  if (KNOWN_SCHEMA_KINDS.includes(kind) && !OBJECT_SCHEMA_KINDS.includes(kind))
    fail(
      "ir.input-proof.input",
      `${pointer}/schema`,
      `${message}: '${String(use.schema)}' is a '${target.kind}' schema.`,
    );
}

// The names a body already carries: the properties of the input's object schema and its form fields.
function bodyNamesOf(input: Json, schemaEntries: Json): Set<unknown> {
  const names = new Set<unknown>();
  const target = refTargetOf(isRecord(input.schema) ? input.schema : {}, schemaEntries);
  const properties = isRecord(target) && Array.isArray(target.properties) ? target.properties : [];
  const fields = Array.isArray(input.fields) ? input.fields : [];

  for (const member of [...properties, ...fields]) if (isRecord(member)) names.add(member.name);

  return names;
}

// A proof is identified by its name: one element per name, and no name the body already carries.
function checkProofNames(input: Json, pointer: string, schemaEntries: Json, fail: Fail): void {
  const taken = bodyNamesOf(input, schemaEntries);
  const seen = new Set<unknown>();

  for (const [i, proof] of proofsOf(input).entries()) {
    if (!isRecord(proof) || typeof proof.name !== "string") continue;

    if (seen.has(proof.name) || taken.has(proof.name))
      fail(
        "ir.input-proof.name",
        `${pointer}/proofs/${i}`,
        `The body proof '${proof.name}' repeats a proof, a property of the input schema or a form field.`,
      );
    seen.add(proof.name);
  }
}

// A body proof is sent as the input's other fields are: with a wire form in a form or multipart body, none in a
// JSON one, and never a file one, since a proof is no file (ir.id.scalar). An unknown media type is the
// reader's to name.
function checkProofWires(input: Json, pointer: string, fail: Fail): void {
  const mediaKnown = isKnown("OperationInput", "media", input.media);
  const fieldMedia = FIELD_MEDIA.includes(String(input.media));

  for (const [i, proof] of proofsOf(input).entries()) {
    if (!isRecord(proof)) continue;

    if (isRecord(proof.wire) && proof.wire.kind === "file")
      fail(
        "ir.input-proof.wire",
        `${pointer}/proofs/${i}`,
        "A body proof's wire kind is not 'file'.",
      );

    if (mediaKnown && has(proof, "wire") !== fieldMedia)
      fail(
        "ir.input-proof.wire",
        `${pointer}/proofs/${i}`,
        `A body proof has 'wire' if and only if the input is form or multipart ('${String(input.media)}').`,
      );
  }
}

// A right's subject kind that needs a subject on the request: every known one but `none`. Undefined for a right
// the document does not hold or an unknown kind, which the reader names.
function subjectNeeded(rights: Json, right: unknown): boolean | undefined {
  const declaration =
    typeof right === "string" && Object.hasOwn(rights, right) ? rights[right] : undefined;
  const subject = isRecord(declaration) ? declaration.subject : undefined;
  const kind = isRecord(subject) ? subject.kind : undefined;

  if (typeof kind !== "string" || !irUnionTags("RightSubject").known.includes(kind))
    return undefined;

  return kind !== "none";
}

function checkSubjectPresence(
  value: Json,
  pointer: string,
  rights: Json,
  id: "ir.field-right.always" | "ir.sort-key.right",
  fail: Fail,
): void {
  const needed = subjectNeeded(rights, value.right);

  if (needed === undefined || needed === has(value, "subject")) return;

  fail(
    id,
    pointer,
    `The right '${String(value.right)}' ${needed ? "reads a subject: 'subject' is required" : "has no subject: 'subject' is absent"}.`,
  );
}

const ALWAYS_EXCLUDED = ["subject", "inputPolicy", "params"];

// A field right that is always absent needs no decide call: an output right with nothing to decide on.
function checkFieldRight(value: Json, pointer: string, rights: Json, fail: Fail): void {
  if (!has(value, "always")) {
    checkSubjectPresence(value, pointer, rights, "ir.field-right.always", fail);

    return;
  }

  if (!isKnown("FieldRight", "always", value.always)) return;

  if (value.direction !== "output" || ALWAYS_EXCLUDED.some((member) => has(value, member)))
    fail(
      "ir.field-right.always",
      pointer,
      "A field right with 'always' is an output right without 'subject', 'inputPolicy' or 'params'.",
    );
}

function checkSortKey(value: Json, pointer: string, rights: Json, fail: Fail): void {
  if (!has(value, "right")) {
    if (has(value, "params") || has(value, "subject"))
      fail(
        "ir.sort-key.right",
        pointer,
        "A sort key has 'params' and 'subject' only with 'right'.",
      );

    return;
  }

  checkSubjectPresence(value, pointer, rights, "ir.sort-key.right", fail);
  const subject = isRecord(value.subject) ? value.subject : {};
  const source = isRecord(subject.source) ? subject.source : {};

  if (source.in === "holderField")
    fail(
      "ir.sort-key.right",
      `${pointer}/subject/source`,
      "A sort key's subject is read on the request, never from a holder field.",
    );
}

const INT64_TEXT = /^-?(0|[1-9][0-9]*)$/;
const DECIMAL_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// Why an opaque value breaks ir.value.exact-number for its scalar use, or undefined. A value of another JSON type
// is the example check's to refuse, and nested values are not checked (README.md).
function inexactNumber(use: Json, value: unknown): string | undefined {
  if (use.kind !== "scalar" || value === null) return undefined;

  if (use.format === "int64" || use.format === "decimal") {
    const pattern = use.format === "int64" ? INT64_TEXT : DECIMAL_TEXT;

    if (typeof value !== "string" || !pattern.test(value))
      return `An ${use.format} value is its string form, not ${JSON.stringify(value)}.`;

    if (
      use.format === "int64" &&
      (value === "-0" || BigInt(value) < INT64_MIN || BigInt(value) > INT64_MAX)
    )
      return `The int64 value '${value}' is -0 or outside -2^63 to 2^63 - 1.`;

    return undefined;
  }

  if (use.type === "integer" && typeof value === "number" && !Number.isSafeInteger(value))
    return `The integer value ${value} is no safe integer: write a larger one as an int64.`;

  return undefined;
}

// The values a member holds for its type use: `default` and each of `examples`, with their pointers.
function checkExactNumbers(use: unknown, holder: Json, pointer: string, fail: Fail): void {
  if (!isRecord(use)) return;
  const values: [string, unknown][] = has(holder, "default")
    ? [[`${pointer}/default`, holder.default]]
    : [];

  if (Array.isArray(holder.examples))
    for (const [i, example] of holder.examples.entries())
      values.push([`${pointer}/examples/${i}`, example]);

  for (const [at, value] of values) {
    const problem = inexactNumber(use, value);

    if (problem !== undefined) fail("ir.value.exact-number", at, problem);
  }
}

// The meta member a format fills with the degraded parts, if it has one.
function hasDegradedMeta(formats: Json, format: unknown): boolean | undefined {
  const declaration =
    typeof format === "string" && Object.hasOwn(formats, format) ? formats[format] : undefined;

  if (!isRecord(declaration)) return undefined;
  const meta = isRecord(declaration.meta) ? declaration.meta : {};

  return Object.values(meta).some((member) => isRecord(member) && member.fill === "degraded");
}

const DEPRECATION_SEMANTICS = ["deprecation", "sunset", "successorLink"] as const;
const SUCCESS_FIRST = 200;
const SUCCESS_LAST = 299;

const isSuccess = (response: unknown): boolean =>
  isRecord(response) &&
  typeof response.status === "number" &&
  response.status >= SUCCESS_FIRST &&
  response.status <= SUCCESS_LAST;

// Each 2xx response of a deprecated operation carries one deprecation and one sunset header, and one successor
// link with a successor; no other response carries any of them (a redirect or a 304 is no success).
function checkDeprecationHeaders(
  operation: Json,
  pointer: string,
  operations: unknown[],
  apiId: unknown,
  fail: Fail,
): void {
  const deprecated = isRecord(operation.deprecated) ? operation.deprecated : undefined;
  const successor = isRecord(deprecated?.successor) ? deprecated.successor : undefined;

  if (deprecated !== undefined && has(deprecated, "successorRel") !== (successor !== undefined))
    fail(
      "ir.deprecation.headers",
      `${pointer}/deprecated`,
      "A deprecation has 'successorRel' if and only if it has 'successor'.",
    );

  const responses = Array.isArray(operation.responses) ? operation.responses : [];

  for (const [i, response] of responses.entries()) {
    const headers = isRecord(response) && Array.isArray(response.headers) ? response.headers : [];
    const signals = deprecated !== undefined && isSuccess(response);

    for (const semantic of DEPRECATION_SEMANTICS) {
      const count = headers.filter(
        (header) => isRecord(header) && header.semantic === semantic,
      ).length;
      const expected =
        !signals || (semantic === "successorLink" && successor === undefined) ? 0 : 1;

      if (count !== expected)
        fail(
          "ir.deprecation.headers",
          `${pointer}/responses/${i}`,
          signals
            ? `A 2xx response of a deprecated operation carries ${expected === 1 ? "one" : "no"} '${semantic}' header, not ${count}.`
            : `Only a 2xx response of a deprecated operation carries a '${semantic}' header; this one carries ${count}.`,
        );
    }
  }

  if (successor === undefined || successor.api !== apiId) return;
  const target = operations.find(
    (candidate) => isRecord(candidate) && candidate.id === successor.id,
  );

  // A successor in another api is checked at compile time only: the document does not hold that api.
  if (!isRecord(target)) {
    fail(
      "ir.deprecation.headers",
      `${pointer}/deprecated/successor`,
      `The successor '${String(successor.id)}' names no operation of this api.`,
    );

    return;
  }

  checkSuccessorParams(operation, target, pointer, fail);
}

const pathParamsOf = (operation: Json): Json[] => {
  const params = isRecord(operation.params) ? operation.params : {};

  return Array.isArray(params.path) ? params.path.filter(isRecord) : [];
};

// The successor link fills the successor's path params from the deprecated request's, so each is one of them.
function checkSuccessorParams(operation: Json, successor: Json, pointer: string, fail: Fail): void {
  const own = pathParamsOf(operation);

  for (const param of pathParamsOf(successor)) {
    const match = own.find((candidate) => candidate.name === param.name);

    if (match === undefined || !isIrSameTypeUse(match.type, param.type))
      fail(
        "ir.deprecation.headers",
        `${pointer}/deprecated/successor`,
        `The successor's path param '${String(param.name)}' is no path param of this operation of the same type.`,
      );
  }
}

function checkDeprecationDates(value: Json, pointer: string, fail: Fail): void {
  const { since, sunset } = value;

  for (const [member, date] of [
    ["since", since],
    ["sunset", sunset],
  ] as const)
    if (typeof date === "string" && !isIrCalendarDate(date))
      fail("ir.deprecation.since", `${pointer}/${member}`, `'${date}' is no calendar day.`);

  if (typeof since === "string" && typeof sunset === "string" && since > sunset)
    fail(
      "ir.deprecation.since",
      pointer,
      `The deprecation starts on ${since}, after its sunset ${sunset}.`,
    );
}

const bindingsOf = (error: unknown): Json[] =>
  isRecord(error) && Array.isArray(error.roles) ? error.roles.filter(isRecord) : [];

// A role is answered by one code on an operation: one binding across its errors.
function checkRolesOnce(operation: Json, pointer: string, fail: Fail): void {
  const seen = new Set<unknown>();
  const errors = Array.isArray(operation.errors) ? operation.errors : [];

  for (const [i, error] of errors.entries())
    for (const [j, binding] of bindingsOf(error).entries()) {
      if (seen.has(binding.role))
        fail(
          "ir.operation.role-once",
          `${pointer}/errors/${i}/roles/${j}`,
          `The role '${String(binding.role)}' is bound twice on the operation.`,
        );
      seen.add(binding.role);
    }
}

const TEMPLATE_SCHEMA = { $ref: "#/$defs/Template" };

// The pointers of the `each` templates of `template`, relative to it.
function eachPointers(template: unknown): string[] {
  const found: string[] = [];

  walkIrInstance(
    template,
    (node) => {
      if (node.kind === "union" && node.definition === "Template" && node.value.kind === "each")
        found.push(node.pointer);
    },
    TEMPLATE_SCHEMA,
  );

  return found;
}

function errorDeclarationOf(errors: Json, code: unknown): Json | undefined {
  const declaration =
    typeof code === "string" && Object.hasOwn(errors, code) ? errors[code] : undefined;

  return isRecord(declaration) ? declaration : undefined;
}

function checkRoleParams(value: Json, pointer: string, errors: Json, fail: Fail): void {
  const declaration = errorDeclarationOf(errors, value.code);

  for (const [j, binding] of bindingsOf(value).entries()) {
    const at = `${pointer}/roles/${j}`;

    if (declaration !== undefined && has(declaration, "params") !== has(binding, "params"))
      fail(
        "ir.error.role-params",
        at,
        `A role binding has 'params' if and only if the code '${String(value.code)}' declares params.`,
      );

    const eaches = eachPointers(binding.params);

    for (const each of eaches)
      if (eaches.some((outer) => each.startsWith(`${outer}/as`)))
        fail(
          "ir.error.role-params",
          `${at}/params${each}`,
          "Role params hold no 'each' inside another 'each'.",
        );
  }
}

const RETRY_STATUS = 429;
const RETRY_DERIVATION = "rule.bucket";
const SAFE_MAXIMUM = Number.MAX_SAFE_INTEGER;

// The property of the code's params schema a retry header reads its delay from.
function retryParamOf(declaration: Json, schemaEntries: Json, param: unknown): Json | undefined {
  const id = declaration.params;
  const schema =
    typeof id === "string" && Object.hasOwn(schemaEntries, id) ? schemaEntries[id] : undefined;
  const properties = isRecord(schema) && Array.isArray(schema.properties) ? schema.properties : [];

  return properties.filter(isRecord).find((property) => property.name === param);
}

// Why a retry header's param cannot render as a non-negative safe integer, or undefined.
function retryParamProblem(property: Json | undefined): string | undefined {
  if (property === undefined || property.optional !== false || property.nullable !== false)
    return "a required, non-nullable property of the code's params";
  const use = isRecord(property.type) ? property.type : {};
  const refinements = isRecord(use.refinements) ? use.refinements : {};

  if (use.kind !== "scalar" || use.type !== "integer" || has(use, "format"))
    return "an integer scalar";

  const minimum = Number(refinements.minimum);
  const maximum = Number(refinements.maximum);

  if (!has(refinements, "minimum") || !(minimum >= 0))
    return "an integer with a minimum of at least 0";

  if (!has(refinements, "maximum") || !(maximum <= SAFE_MAXIMUM))
    return `an integer with a maximum of at most ${SAFE_MAXIMUM}`;

  return undefined;
}

function checkRetryHeader(
  value: Json,
  pointer: string,
  errors: Json,
  schemaEntries: Json,
  fail: Fail,
): void {
  const header = value.retryHeader;

  if (!isRecord(header)) return;
  const at = `${pointer}/retryHeader`;
  const declaration = errorDeclarationOf(errors, value.code);
  const http = isRecord(declaration?.http) ? declaration.http : {};

  if (declaration !== undefined && http.status !== RETRY_STATUS)
    fail(
      "ir.error.retry-header",
      at,
      `A retry header sits on a ${RETRY_STATUS} code only, not on '${String(value.code)}'.`,
    );

  const derivedFrom = isRecord(header.derivedFrom) ? header.derivedFrom : {};

  if (derivedFrom.derivation !== RETRY_DERIVATION)
    fail("ir.error.retry-header", at, `A retry header is derived from '${RETRY_DERIVATION}'.`);

  if (declaration === undefined) return;
  const problem = retryParamProblem(retryParamOf(declaration, schemaEntries, header.param));

  if (problem !== undefined)
    fail(
      "ir.error.retry-header",
      at,
      `The retry header's param '${String(header.param)}' is ${problem}.`,
    );
}

/** A sensitive property and the schema holding it. */
interface SensitiveProperty {
  schema: string;
  property: string;
}

// The first sensitive property a type use reaches (ADR 0003 section 6): through array items, JSON content,
// object properties, map values and union variants, each schema walked once so a recursive schema ends. An
// unknown use or schema kind is the reader's to name, and a missing schema is ir.ref.resolves'.
function sensitiveBelow(
  use: unknown,
  schemaEntries: Json,
  visited: Set<string>,
): SensitiveProperty | undefined {
  if (!isRecord(use)) return undefined;

  switch (use.kind) {
    case "array":
      return sensitiveBelow(use.items, schemaEntries, visited);
    case "scalar":
      return isRecord(use.content)
        ? sensitiveBelow(use.content.schema, schemaEntries, visited)
        : undefined;
    case "ref":
      return typeof use.schema === "string"
        ? sensitiveInSchema(use.schema, schemaEntries, visited)
        : undefined;
    default:
      return undefined;
  }
}

function sensitiveInSchema(
  id: string,
  schemaEntries: Json,
  visited: Set<string>,
): SensitiveProperty | undefined {
  if (visited.has(id) || !Object.hasOwn(schemaEntries, id)) return undefined;

  visited.add(id);
  const schema = schemaEntries[id];

  if (!isRecord(schema)) return undefined;

  switch (schema.kind) {
    case "object":
      return sensitiveProperty(id, schema.properties, schemaEntries, visited);
    case "map":
      return sensitiveBelow(schema.values, schemaEntries, visited);
    case "union":
      return sensitiveVariant(schema.variants, schemaEntries, visited);
    default:
      return undefined;
  }
}

function sensitiveProperty(
  id: string,
  properties: unknown,
  schemaEntries: Json,
  visited: Set<string>,
): SensitiveProperty | undefined {
  for (const property of Array.isArray(properties) ? properties : []) {
    if (!isRecord(property)) continue;

    if (property.sensitive === true) return { schema: id, property: String(property.name) };

    const found = sensitiveBelow(property.type, schemaEntries, visited);

    if (found !== undefined) return found;
  }

  return undefined;
}

function sensitiveVariant(
  variants: unknown,
  schemaEntries: Json,
  visited: Set<string>,
): SensitiveProperty | undefined {
  for (const variant of Array.isArray(variants) ? variants : []) {
    if (!isRecord(variant) || typeof variant.schema !== "string") continue;

    const found = sensitiveInSchema(variant.schema, schemaEntries, visited);

    if (found !== undefined) return found;
  }

  return undefined;
}

// A response that carries a sensitive field is never stored: the operation has a `cache` that sets `noStore`.
function checkSensitiveNoStore(
  operation: Json,
  pointer: string,
  schemaEntries: Json,
  fail: Fail,
): void {
  const cache = isRecord(operation.cache) ? operation.cache : undefined;

  if (cache?.noStore === true) return;

  const responses = Array.isArray(operation.responses) ? operation.responses : [];
  const visited = new Set<string>();

  for (const response of responses) {
    const found = isRecord(response)
      ? sensitiveBelow(response.body, schemaEntries, visited)
      : undefined;

    if (found === undefined) continue;

    fail(
      "ir.cache.sensitive-no-store",
      pointer,
      `A response carries the sensitive property '${found.property}' of '${found.schema}', so the operation's 'cache' sets 'noStore'.`,
    );

    return;
  }
}

interface OperationScope {
  formats: Json;
  operations: unknown[];
  apiId: unknown;
  schemaEntries: Json;
}

// The rules that read an operation as a whole: its degradable header, its deprecation headers, its role bindings,
// the no-store of a sensitive response.
function checkOperationMembers(
  operation: Json,
  pointer: string,
  scope: OperationScope,
  fail: Fail,
): void {
  if (isRecord(operation.degradable) && !has(operation.degradable, "header")) {
    const degradedMeta = hasDegradedMeta(scope.formats, operation.format);

    if (degradedMeta === false)
      fail(
        "ir.degradable.header",
        `${pointer}/degradable`,
        `A degradable operation whose format '${String(operation.format)}' has no 'degraded' meta member has 'header'.`,
      );
  }

  checkDeprecationHeaders(operation, pointer, scope.operations, scope.apiId, fail);
  checkRolesOnce(operation, pointer, fail);
  checkSensitiveNoStore(operation, pointer, scope.schemaEntries, fail);
}

// Returns every invariant violation of an IR document, empty for a sound one. Pure and Ajv-free; it expects a
// document the open form accepts and never throws on one it refuses.
export function checkIrInvariants(ir: unknown): IrInvariantViolation[] {
  const violations: IrInvariantViolation[] = [];
  const fail = (id: IrInvariantId, pointer: string, message: string) =>
    violations.push({ id, pointer, message });
  const objects = new Map<string, string | undefined>(); // pointer to definition, for placement rules
  const nodes: Extract<IrInstanceNode, { kind: "object" }>[] = [];
  const ids: Extract<IrInstanceNode, { kind: "string" }>[] = [];

  walkIrInstance(ir, (node) => {
    if (node.kind === "string") ids.push(node);

    if (node.kind !== "object") return;
    objects.set(node.pointer, node.definition);
    nodes.push(node);
  });
  const doc = isRecord(ir) ? ir : {};
  const schemes = isRecord(doc.schemes) ? doc.schemes : {};
  const schemaEntries = isRecord(doc.schemas) ? doc.schemas : {};
  const rights = isRecord(doc.rights) ? doc.rights : {};
  const errors = isRecord(doc.errors) ? doc.errors : {};
  const formats = isRecord(doc.formats) ? doc.formats : {};
  const operations = Array.isArray(doc.operations) ? doc.operations : [];
  const apiId = isRecord(doc.api) ? doc.api.id : undefined;

  // Every member holding a catalogue id names an existing entry (keys read with Object.hasOwn: a right may be
  // named `__proto__`).
  for (const { pointer, definition, value } of ids) {
    const catalogue = CATALOGUES.get(definition);

    if (catalogue === undefined) continue;
    const owner = catalogue.owner === "ContractIR" ? doc : doc.api;
    const entries = isRecord(owner) ? owner[catalogue.member] : undefined;

    if (isRecord(entries) && !Object.hasOwn(entries, value))
      fail("ir.ref.resolves", pointer, `'${value}' names no entry of '${catalogue.member}'.`);
  }

  for (const { pointer, definition, value } of nodes) {
    switch (definition) {
      case "Origin": {
        // A core origin's pointer starts with its entry of a catalogue (`/errors/api.internal`, or
        // `/errors/api.rate_limited/params` for that code's params schema, ADR 0004 section 6); only that entry is
        // checked. It has no side-table entry, so the entry must be in this document unless the origin names
        // another api (a relay route's copy, read in that api).
        if (value.layer !== "core" || typeof value.pointer !== "string") break;
        const [catalogue = "", id] = value.pointer.split("/").slice(1).map(unescapeSegment);

        if (!CORE_CATALOGUES.includes(catalogue) || id === undefined || id === "") {
          fail(
            "ir.origin.core",
            pointer,
            `A core origin points at an entry of ${CORE_CATALOGUES.join(", ")}: '${value.pointer}' does not.`,
          );
          break;
        }

        const entries = doc[catalogue];

        if (!has(value, "api") && isRecord(entries) && !Object.hasOwn(entries, id))
          fail(
            "ir.origin.core",
            pointer,
            `A core origin names '${id}', which is no entry of '${catalogue}'.`,
          );
        break;
      }

      case "OperationInput": {
        checkProofInput(value, pointer, schemaEntries, fail);
        checkProofNames(value, pointer, schemaEntries, fail);
        checkProofWires(value, pointer, fail);
        break;
      }

      case "Name": {
        if (!isKnown("Name", "role", value.role)) break;

        if ((value.role === "response") !== has(value, "status"))
          fail(
            "ir.name.status",
            pointer,
            "A name has 'status' if and only if its role is 'response'.",
          );
        break;
      }

      case "MetaMember": {
        if (!isKnown("MetaMember", "fill", value.fill)) break;

        if ((value.fill === "source") !== has(value, "source"))
          fail(
            "ir.meta.source",
            pointer,
            "A $meta member has 'source' if and only if 'fill' is 'source'.",
          );
        break;
      }

      case "ValueSource": {
        const source = value.in;

        if (typeof source !== "string" || !isKnown("ValueSource", "in", source)) break;

        if (NAMED_SOURCES.includes(source) && (!has(value, "name") || has(value, "prefixBits")))
          fail(
            "ir.value-source.members",
            pointer,
            `A '${source}' source has 'name' and no 'prefixBits'.`,
          );

        if (BARE_SOURCES.includes(source) && has(value, "name"))
          fail("ir.value-source.members", pointer, `A '${source}' source has no 'name'.`);

        if (source !== "address" && BARE_SOURCES.includes(source) && has(value, "prefixBits"))
          fail("ir.value-source.members", pointer, "Only an 'address' source has 'prefixBits'.");
        const parent = objects.get(parentOf(pointer));

        if (source === "resolver" && parent !== "OperationScope")
          fail("ir.value-source.place", pointer, "A 'resolver' source is a scope source only.");

        if (source === "holderField" && parent !== "FieldRightSubject")
          fail(
            "ir.value-source.place",
            pointer,
            "A 'holderField' source is a field right subject only.",
          );
        break;
      }

      case "HeaderDecl": {
        if (!isKnown("HeaderDecl", "semantic", value.semantic)) break;
        const token = value.semantic === "versionToken";
        const tokenMembers = has(value, "response") && has(value, "request");
        const plainMembers = has(value, "name") && has(value, "in");
        const ok = token
          ? tokenMembers && !has(value, "name") && !has(value, "in")
          : plainMembers && !has(value, "response") && !has(value, "request");

        if (!ok)
          fail(
            "ir.header.members",
            pointer,
            token
              ? "A versionToken header has 'response' and 'request', and no 'name' or 'in'."
              : "A header has 'name' and 'in', and no 'response' or 'request' (versionToken only).",
          );
        break;
      }

      case "Cache": {
        const never = value.family === "never";

        if (never === has(value, "directives"))
          fail(
            "ir.cache.directives",
            pointer,
            "Cache 'directives' are absent if and only if the family is 'never'.",
          );

        if (never && value.noStore !== true)
          fail("ir.cache.directives", pointer, "A 'never' cache family sets 'noStore'.");
        break;
      }

      case "Operation": {
        checkOperationMembers(value, pointer, { formats, operations, apiId, schemaEntries }, fail);
        const access = value.access;

        if (value.safe !== false || !isRecord(access)) break;

        if (access.kind !== "identity" && access.kind !== "optional") break;
        const accepted = Array.isArray(access.schemes) ? access.schemes : [];
        const cookie = accepted.some((id) => {
          const scheme =
            typeof id === "string" && Object.hasOwn(schemes, id) ? schemes[id] : undefined;

          return isRecord(scheme) && scheme.kind === "cookie";
        });

        if (cookie && !has(value, "csrf"))
          fail(
            "ir.csrf.cookie",
            pointer,
            "An unsafe operation reached through a cookie scheme has 'csrf'.",
          );
        break;
      }

      case "FieldWire": {
        const kind = value.kind;

        if (PLAIN_WIRE_KINDS.includes(String(kind))) {
          if (QUERY_WIRE_MEMBERS.some((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has no style, explode or brackets.`,
            );
        } else if (QUERY_WIRE_KINDS.includes(String(kind)) && isKnown("FieldWire", "kind", kind)) {
          if (!QUERY_WIRE_MEMBERS.every((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has style, explode and brackets.`,
            );
        }

        break;
      }

      case "FieldRight":
        checkFieldRight(value, pointer, rights, fail);
        break;

      case "SortKey":
        checkSortKey(value, pointer, rights, fail);
        break;

      case "Deprecation":
        checkDeprecationDates(value, pointer, fail);
        break;

      case "OperationError":
        checkRoleParams(value, pointer, errors, fail);
        checkRetryHeader(value, pointer, errors, schemaEntries, fail);
        break;

      case "Param":
        checkExactNumbers(value.type, value, pointer, fail);
        break;

      case "ScalarTypeUse":
        checkExactNumbers(value, { examples: value.examples }, pointer, fail);
        break;

      case "Property": {
        checkExactNumbers(value.type, value, pointer, fail);

        if (isRecord(value.type) && has(value.type, "nullable"))
          fail(
            "ir.property.nullable",
            pointer,
            "A property's type use has no 'nullable': the property holds it.",
          );
        break;
      }

      case "Scope":
      case "ResourceSubject": {
        const use = value.idSchema;

        if (!isRecord(use) || !KNOWN_TYPE_USE_KINDS.includes(String(use.kind))) break;

        if (!ID_TYPE_KINDS.includes(String(use.kind)) || has(use, "nullable"))
          fail(
            "ir.id.scalar",
            `${pointer}/idSchema`,
            "An id's type use is a 'scalar' or 'enum' use without 'nullable'.",
          );
        break;
      }

      // A rule's proof and the body field it adds to an operation's input (`InputProof`) are typed alike.
      case "RuleProof":
      case "InputProof": {
        const use = value.schema;

        if (isRecord(use) && PROOF_REFUSED_KINDS.includes(String(use.kind)))
          fail(
            "ir.id.scalar",
            `${pointer}/schema`,
            "A rule proof's type use is neither 'opaque' nor 'file'.",
          );
        break;
      }

      case "Scalar": {
        if (isRecord(value.type) && has(value.type, "scalar"))
          fail("ir.scalar.type", pointer, "A named format's own type names no 'scalar'.");
        break;
      }
    }
  }

  return violations;
}
