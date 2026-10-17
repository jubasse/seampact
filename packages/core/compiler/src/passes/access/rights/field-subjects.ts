import type { IrWriter } from "@seampact/spec/ir";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import type { AccessRightsRestrictedField } from "./restricted-fields.js";
import { accessRightsRestrictionOrigin } from "./restrictions.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import {
  type AccessRightsSourceSchema,
  accessRightsDefaultMemberId,
  accessRightsPropertySchema,
  accessRightsSameSchema,
} from "./subjects.js";

// The subject of a field right (ADR 0003 section 6), which follows from the right: a scope right takes the route's
// resolved scope; a resource right takes, on input, the route's default subject (the nearest member id), and on
// output the holder's one required property whose schema is the right's id schema. A subject that cannot be found
// is an error, on output too, fail closed, until the IR can say "always absent" on a field right.
//
// Each error names the field in its once key, so two fields of one route that fail are both reported.

/** The route a field right is listed on, with its resolved scopes. */
export interface AccessRightsFieldRoute {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
}

/** A found subject (absent for a right without one), or undefined after an error. */
export type AccessRightsSubjectResult = { readonly subject?: IrWriter.FieldRightSubject } | undefined;

/** The field as a message names it: the body's schema and the pointer. */
export const accessRightsFieldText = (field: AccessRightsRestrictedField): string =>
  accessRightsQuoted(`${field.schema}${field.pointer}`);

const restrictedHere = (field: AccessRightsRestrictedField) => [
  {
    pointer: accessRightsRestrictionOrigin(field.restriction).pointer,
    message: `the field is restricted to '${accessRightsQuoted(field.restriction.right)}' here`,
  },
];

/** The schema a resource right's subject must have: its id schema, with the schema it names. */
export function accessRightsIdSchemaOf(
  catalogues: AccessRightsCatalogues,
  right: IrWriter.Right,
  subject: IrWriter.ResourceSubject,
): AccessRightsSourceSchema {
  const name = catalogues.rightIdNames.get(right.id);

  return { use: subject.idSchema, ...(name === undefined ? {} : { name }) };
}

// On input the subject must be found (ADR 0003 section 6). A `create` route has no member id of the resource it
// creates, so a resource right cannot restrict its input.
export function accessRightsInputSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes }: AccessRightsFieldRoute,
  field: AccessRightsRestrictedField,
  right: IrWriter.Right,
): AccessRightsSubjectResult {
  const pointer = route.operation.input?.origin.pointer ?? route.node.pointer;
  const distinctBy = `${field.schema}${field.pointer}`;
  const fieldText = accessRightsFieldText(field);

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
      message: `input field '${fieldText}' of create route '${route.id}' is restricted to resource right '${accessRightsQuoted(right.id)}', and a create route has no id of the resource it creates`,
      fix: "restrict the field in the create input to a scope right or a right without subject",
      pointer,
      distinctBy,
      related: restrictedHere(field),
    });

    return undefined;
  }

  const defaulted = accessRightsDefaultMemberId(
    context,
    route.node,
    accessRightsIdSchemaOf(catalogues, right, right.subject),
  );

  if (defaulted.kind === "found") return { subject: { source: defaulted.source } };

  reporter.error({
    rule: "field-right-subject",
    message:
      defaulted.kind === "ambiguous"
        ? `input field '${fieldText}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}', and its subject could be member id ${defaulted.candidates.map(({ name }) => `'${name}'`).join(" or ")}`
        : `input field '${fieldText}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}', and no member id of the route has its id schema`,
    fix: "restrict the field to a right whose subject the route resolves, or use another input schema on this route",
    pointer,
    distinctBy,
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

interface ScopeUse extends AccessRightsFieldRoute {
  readonly field: AccessRightsRestrictedField;
  readonly right: IrWriter.Right;
  readonly pointer: string;
}

function scopeSubject(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes, field, right, pointer }: ScopeUse,
  scope: string,
): AccessRightsSubjectResult {
  // The right's scope is refused: its declaration has the error, so a use adds none.
  if (!catalogues.scopes.has(scope)) return undefined;

  if (scopes.some((resolved) => resolved.scope === scope))
    return { subject: { source: { in: "scope", name: scope } } };

  reporter.error({
    rule: "field-right-subject",
    message: `field '${accessRightsFieldText(field)}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}' of scope '${accessRightsQuoted(scope)}', which the route does not resolve`,
    fix: `enter scope '${scope}' on the route or an ancestor, or restrict the field to another right`,
    pointer,
    distinctBy: `${field.schema}${field.pointer}`,
    related: restrictedHere(field),
  });

  return undefined;
}

// On output a resource right reads the holder's property whose schema is the right's id schema. The property must
// be required: an optional one would leave the field with a right and no subject value.
export function accessRightsOutputSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes }: AccessRightsFieldRoute,
  field: AccessRightsRestrictedField,
  right: IrWriter.Right,
): AccessRightsSubjectResult {
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

  const expected = accessRightsIdSchemaOf(catalogues, right, right.subject);
  const holders = field.holder.properties.filter((property) =>
    accessRightsSameSchema(accessRightsPropertySchema(context, property), expected),
  );
  const [only, ...others] = holders;
  const fieldText = accessRightsFieldText(field);
  const holderText = accessRightsQuoted(field.holder.id);

  if (only !== undefined && others.length === 0 && !only.optional)
    return { subject: { source: { in: "holderField", name: only.name } } };

  reporter.error({
    rule: "field-right-subject",
    message:
      only === undefined
        ? `output field '${fieldText}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}', and its holder '${holderText}' has no property of the right's id schema`
        : others.length > 0
          ? `output field '${fieldText}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}', and its holder '${holderText}' has several properties of the right's id schema: ${holders.map(({ name }) => `'${accessRightsQuoted(name)}'`).join(", ")}`
          : `output field '${fieldText}' of route '${route.id}' is restricted to right '${accessRightsQuoted(right.id)}', and the subject '${accessRightsQuoted(only.name)}' of its holder '${holderText}' is optional: the subject must be a required field`,
    fix: `give '${holderText}' exactly one required property of the right's id schema, or restrict the field to another right`,
    pointer,
    distinctBy: `${field.schema}${field.pointer}`,
    related: restrictedHere(field),
  });

  return undefined;
}
