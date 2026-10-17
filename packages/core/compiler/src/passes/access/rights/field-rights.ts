import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCopy,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { accessRightsCheckParams } from "./params.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import {
  type AccessRightsSourceSchema,
  accessRightsDefaultMemberId,
  accessRightsPropertySchema,
  accessRightsSameSchema,
} from "./subjects.js";

// The field rights of an operation (FR-23, A21, ADR 0003 section 6): one entry per `restrictedTo` property
// reachable from its input or a response body, per pointer and direction, sorted by schema, pointer, direction.
// A pointer is relative to the body's schema, `*` standing for an array item or a map value (`/items/*/effort`).
// The subject follows from the right: a scope right takes the route's resolved scope; a resource right takes, on
// input, the route's default subject (the nearest member id), and on output the holder's property whose schema is
// the right's id schema. A relay route has none (ADR 0002 section 7).
//
// Two cases are refused where ADR 0003 section 6 leaves them open, fail closed: an output subject that cannot be
// found (the IR has no way to say "always absent" yet), and a restricted field below a recursive reference (its
// pointers have no end).

type DraftSchemas = PassReadonly<DraftIR["schemas"]>;
type DraftObjectSchema = Extract<DraftSchemas[string], { kind: "object" }>;
type DraftProperty = DraftObjectSchema["properties"][number];
type DraftTypeUse = DraftProperty["type"];

/** A restricted property reached from a body: the body's schema, the pointer, and the object holding it. */
interface RestrictedField {
  readonly schema: string;
  readonly pointer: string;
  readonly holder: DraftObjectSchema;
  readonly property: DraftProperty;
  readonly restriction: PassReadonly<IrWriter.FieldRestriction>;
}

/** A checked restriction: its declared right and its params, copied. */
export interface AccessRightsCheckedRestriction {
  readonly right: IrWriter.Right;
  readonly params?: unknown;
}

/**
 * Checks each `restrictedTo` once, whatever the number of routes and pointers that reach it: its right is declared
 * and its params fit. A failed one is remembered as undefined, so its uses add no error. Recursive schemas are
 * reported once each.
 */
export interface AccessRightsRestrictionChecks {
  readonly checked: Map<string, AccessRightsCheckedRestriction | undefined>;
  readonly recursive: Set<string>;
}

export const accessRightsRestrictionChecks = (): AccessRightsRestrictionChecks => ({
  checked: new Map(),
  recursive: new Set(),
});

export interface AccessRightsFieldRightsInput {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly schemas: DraftSchemas;
}

type Direction = "input" | "output";

export function accessRightsFieldRights(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  input: AccessRightsFieldRightsInput,
): IrWriter.FieldRight[] {
  const { operation } = input.route;

  if (operation.relays !== undefined) return [];

  const reached = new Map<string, { field: RestrictedField; direction: Direction }>();
  const walk = { reporter, schemas: input.schemas, checks, route: input.route };
  const add = (direction: Direction) => (field: RestrictedField) =>
    reached.set(`${field.schema}\n${field.pointer}\n${direction}`, { field, direction });

  if (operation.input !== undefined) restrictedFields(walk, operation.input.schema, add("input"));

  for (const response of operation.responses ?? [])
    if (response.body !== undefined) restrictedFields(walk, response.body, add("output"));

  const fieldRights: IrWriter.FieldRight[] = [];

  for (const { field, direction } of [...reached.values()].sort(byLocation)) {
    const checked = accessRightsCheckRestriction(
      context,
      reporter,
      catalogues,
      checks,
      field.restriction,
    );

    if (checked === undefined) continue;

    const subject =
      direction === "input"
        ? inputSubject(context, reporter, catalogues, input, field, checked.right)
        : outputSubject(context, reporter, catalogues, input, field, checked.right);

    if (subject === undefined) continue;

    fieldRights.push(fieldRightOf(context, field, direction, checked, subject));
  }

  return fieldRights;
}

function fieldRightOf(
  context: AccessRightsContext,
  field: RestrictedField,
  direction: Direction,
  checked: AccessRightsCheckedRestriction,
  { subject }: { readonly subject?: IrWriter.FieldRightSubject },
): IrWriter.FieldRight {
  return {
    schema: field.schema,
    pointer: field.pointer,
    right: checked.right.id,
    ...(checked.params === undefined ? {} : { params: pipelineCopy(checked.params) }),
    ...(subject === undefined ? {} : { subject }),
    direction,
    ...(direction === "input" ? { inputPolicy: inputPolicyOf(context, field.restriction) } : {}),
    derivedFrom: {
      derivation: "fieldRight.restricted",
      from: [pipelineCopy(accessRightsRestrictionOrigin(field.restriction))],
    },
  };
}

const compared = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byLocation = (
  left: { field: RestrictedField; direction: Direction },
  right: { field: RestrictedField; direction: Direction },
): number =>
  compared(left.field.schema, right.field.schema) ||
  compared(left.field.pointer, right.field.pointer) ||
  compared(left.direction, right.direction);

// The field's own `input`, else `conventions.restrictedInput` (reject by default, A21).
function inputPolicyOf(
  context: AccessRightsContext,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): IrWriter.InputPolicy {
  if (restriction.inputPolicy !== undefined) return restriction.inputPolicy;

  const convention = context.conventions.get("restrictedInput")?.value;

  if (convention !== "reject" && convention !== "strip")
    throw new Error(
      `conventions.restrictedInput resolves to no policy: ${JSON.stringify(convention)}`,
    );

  return convention;
}

/** The origin tree.schemas gave a `restrictedTo`, where its errors are located. */
export function accessRightsRestrictionOrigin(
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): PassReadonly<IrWriter.Origin> {
  if (restriction.origin === undefined)
    throw new Error(
      `tree.schemas wrote a restrictedTo of right '${restriction.right}' without origin`,
    );

  return restriction.origin;
}

/** A restriction's right is declared and its params fit, checked once per restriction. */
export function accessRightsCheckRestriction(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): AccessRightsCheckedRestriction | undefined {
  const pointer = accessRightsRestrictionOrigin(restriction).pointer;

  if (checks.checked.has(pointer)) return checks.checked.get(pointer);

  const result = checkedRestriction(context, reporter, catalogues, restriction, pointer);

  checks.checked.set(pointer, result);

  return result;
}

function checkedRestriction(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
  pointer: string,
): AccessRightsCheckedRestriction | undefined {
  const right = catalogues.rights.get(restriction.right);

  if (right === undefined) {
    if (!catalogues.declared.rights.has(restriction.right))
      reporter.error({
        rule: "field-right-target",
        message: `the field is restricted to right '${restriction.right}', which the rights catalogue does not declare`,
        fix: "declare the right in 'rights', or name a declared one",
        pointer,
      });

    return undefined;
  }

  const checked = accessRightsCheckParams(context, reporter, {
    rule: "field-right-params",
    kind: "right",
    name: right.id,
    holder: "the field's restrictedTo",
    schema: right.params,
    params: restriction.params,
    paramsPointer: pipelinePointerBelow(pointer, "params"),
    usePointer: pointer,
  });

  return checked === undefined ? undefined : { right, ...checked };
}

interface Walk {
  readonly reporter: AccessRightsReporter;
  readonly schemas: DraftSchemas;
  readonly checks: AccessRightsRestrictionChecks;
  readonly route: AccessRightsRoute;
}

// A body that is not a reference (an array of them) is walked from each schema it reaches, its pointers relative
// to that schema, since an entry names a schema.
function restrictedFields(
  walk: Walk,
  use: PassReadonly<DraftTypeUse>,
  found: (field: RestrictedField) => void,
): void {
  if (use.kind === "array") {
    restrictedFields(walk, use.items, found);

    return;
  }

  if (use.kind !== "ref") return;

  walkSchema(walk, { root: use.schema, prefix: "", path: [use.schema], found }, use.schema);
}

interface WalkAt {
  readonly root: string;
  readonly prefix: string;
  /** The schemas referenced from the root down to here, to stop at a recursive reference. */
  readonly path: readonly string[];
  readonly found: (field: RestrictedField) => void;
}

function schemaOf(schemas: DraftSchemas, id: string): DraftSchemas[string] {
  const schema = Object.hasOwn(schemas, id) ? schemas[id] : undefined;

  if (schema === undefined)
    throw new Error(`a type use references schema '${id}', which tree.schemas did not write`);

  return schema;
}

function walkSchema(walk: Walk, at: WalkAt, id: string): void {
  const schema = schemaOf(walk.schemas, id);

  switch (schema.kind) {
    case "object":
      for (const property of schema.properties) {
        const pointer = pipelinePointerBelow(at.prefix, property.name);

        if (property.restrictedTo !== undefined)
          at.found({
            schema: at.root,
            pointer,
            holder: schema,
            property,
            restriction: property.restrictedTo,
          });

        walkUse(walk, { ...at, prefix: pointer }, property.type);
      }

      return;
    case "map":
      walkUse(walk, { ...at, prefix: pipelinePointerBelow(at.prefix, "*") }, schema.values);

      return;
    case "union":
      for (const variant of schema.variants) walkReference(walk, at, variant.schema);

      return;
    default:
      throw new Error(
        `schema '${id}' has a kind access.rights cannot walk: ${JSON.stringify(schema)}`,
      );
  }
}

function walkUse(walk: Walk, at: WalkAt, use: PassReadonly<DraftTypeUse>): void {
  if (use.kind === "array") {
    walkUse(walk, { ...at, prefix: pipelinePointerBelow(at.prefix, "*") }, use.items);

    return;
  }

  if (use.kind === "ref") walkReference(walk, at, use.schema);
}

function walkReference(walk: Walk, at: WalkAt, id: string): void {
  if (!at.path.includes(id)) {
    walkSchema(walk, { ...at, path: [...at.path, id] }, id);

    return;
  }

  if (!reachesRestriction(walk.schemas, id, new Set()) || walk.checks.recursive.has(id)) return;

  walk.checks.recursive.add(id);
  walk.reporter.error({
    rule: "field-right-recursive",
    message: `schema '${id}' holds a restricted field and references itself below '${at.root}${at.prefix}', so route '${walk.route.id}' would have field rights at pointers without end`,
    fix: "restrict the field in a schema that is not recursive, or end the recursion before it",
    pointer: schemaOf(walk.schemas, id).origin.pointer,
  });
}

function reachesRestriction(schemas: DraftSchemas, id: string, seen: Set<string>): boolean {
  if (seen.has(id)) return false;
  seen.add(id);

  const schema = schemaOf(schemas, id);
  const reachesUse = (use: PassReadonly<DraftTypeUse>): boolean =>
    use.kind === "array"
      ? reachesUse(use.items)
      : use.kind === "ref" && reachesRestriction(schemas, use.schema, seen);

  switch (schema.kind) {
    case "object":
      return schema.properties.some(
        (property) => property.restrictedTo !== undefined || reachesUse(property.type),
      );
    case "map":
      return reachesUse(schema.values);
    case "union":
      return schema.variants.some((variant) => reachesRestriction(schemas, variant.schema, seen));
    default:
      return false;
  }
}

type SubjectResult = { readonly subject?: IrWriter.FieldRightSubject } | undefined;

const fieldText = (field: RestrictedField): string => `${field.schema}${field.pointer}`;

const restrictedHere = (field: RestrictedField) => [
  {
    pointer: accessRightsRestrictionOrigin(field.restriction).pointer,
    message: `the field is restricted to '${field.restriction.right}' here`,
  },
];

function idSchemaOf(
  catalogues: AccessRightsCatalogues,
  right: IrWriter.Right,
  subject: IrWriter.ResourceSubject,
): AccessRightsSourceSchema {
  const name = catalogues.rightIdNames.get(right.id);

  return { use: subject.idSchema, ...(name === undefined ? {} : { name }) };
}

// On input the subject must be found (ADR 0003 section 6). A `create` route has no member id of the resource it
// creates, so a resource right cannot restrict its input.
function inputSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes }: AccessRightsFieldRightsInput,
  field: RestrictedField,
  right: IrWriter.Right,
): SubjectResult {
  const pointer = route.operation.input?.origin.pointer ?? route.node.pointer;

  switch (right.subject.kind) {
    case "none":
      return {};
    case "scope":
      return scopeSubject(
        reporter,
        catalogues,
        { route, scopes, field, right, pointer },
        right.subject.scope,
      );
    case "resource":
      break;
  }

  if (route.operation.op === "create") {
    reporter.error({
      rule: "field-right-subject",
      message: `input field '${fieldText(field)}' of create route '${route.id}' is restricted to resource right '${right.id}', and a create route has no id of the resource it creates`,
      fix: "restrict the field in the create input to a scope right or a right without subject",
      pointer,
      related: restrictedHere(field),
    });

    return undefined;
  }

  const defaulted = accessRightsDefaultMemberId(
    context,
    route.node,
    idSchemaOf(catalogues, right, right.subject),
  );

  if (defaulted.kind === "found") return { subject: { source: defaulted.source } };

  reporter.error({
    rule: "field-right-subject",
    message:
      defaulted.kind === "ambiguous"
        ? `input field '${fieldText(field)}' of route '${route.id}' is restricted to right '${right.id}', and its subject could be member id ${defaulted.candidates.map(({ name }) => `'${name}'`).join(" or ")}`
        : `input field '${fieldText(field)}' of route '${route.id}' is restricted to right '${right.id}', and no member id of the route has its id schema`,
    fix: "restrict the field to a right whose subject the route resolves, or use another input schema on this route",
    pointer,
    related: [
      ...restrictedHere(field),
      ...(defaulted.kind === "ambiguous" ? defaulted.candidates : []).map((candidate) => ({
        pointer: candidate.pointer,
        message: `member id '${candidate.name}' has the right's id schema`,
      })),
    ],
  });

  return undefined;
}

interface ScopeUse {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly field: RestrictedField;
  readonly right: IrWriter.Right;
  readonly pointer: string;
}

function scopeSubject(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes, field, right, pointer }: ScopeUse,
  scope: string,
): SubjectResult {
  // The right's scope is refused: its declaration has the error, so a use adds none.
  if (!catalogues.scopes.has(scope)) return undefined;

  if (scopes.some((resolved) => resolved.scope === scope))
    return { subject: { source: { in: "scope", name: scope } } };

  reporter.error({
    rule: "field-right-subject",
    message: `field '${fieldText(field)}' of route '${route.id}' is restricted to right '${right.id}' of scope '${scope}', which the route does not resolve`,
    fix: `enter scope '${scope}' on the route or an ancestor, or restrict the field to another right`,
    pointer,
    related: restrictedHere(field),
  });

  return undefined;
}

// On output a resource right reads the holder's property whose schema is the right's id schema.
function outputSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes }: AccessRightsFieldRightsInput,
  field: RestrictedField,
  right: IrWriter.Right,
): SubjectResult {
  const pointer = route.node.pointer;

  switch (right.subject.kind) {
    case "none":
      return {};
    case "scope":
      return scopeSubject(
        reporter,
        catalogues,
        { route, scopes, field, right, pointer },
        right.subject.scope,
      );
    case "resource":
      break;
  }

  const expected = idSchemaOf(catalogues, right, right.subject);
  const holders = field.holder.properties.filter((property) =>
    accessRightsSameSchema(accessRightsPropertySchema(context, property), expected),
  );
  const [only, ...others] = holders;

  if (only !== undefined && others.length === 0)
    return { subject: { source: { in: "holderField", name: only.name } } };

  reporter.error({
    rule: "field-right-subject",
    message:
      only === undefined
        ? `output field '${fieldText(field)}' of route '${route.id}' is restricted to right '${right.id}', and its holder '${field.holder.id}' has no property of the right's id schema`
        : `output field '${fieldText(field)}' of route '${route.id}' is restricted to right '${right.id}', and its holder '${field.holder.id}' has several properties of the right's id schema: ${holders.map(({ name }) => `'${name}'`).join(", ")}`,
    fix: `give '${field.holder.id}' exactly one property of the right's id schema, or restrict the field to another right`,
    pointer,
    related: restrictedHere(field),
  });

  return undefined;
}
