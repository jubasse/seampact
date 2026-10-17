import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelineJsonAtPointer,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { accessRightsIdSchemaOf } from "./field-subjects.js";
import { accessRightsString } from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import type { AccessRightsObjectSchema } from "./restricted-fields.js";
import {
  type AccessRightsRestrictionChecks,
  accessRightsCheckRestriction,
  accessRightsRestrictionOrigin,
} from "./restrictions.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import {
  accessRightsDefaultMemberId,
  accessRightsPropertySchema,
  accessRightsSameSchema,
} from "./subjects.js";

// The rights of a list's sort keys (FR-23, SCN-067, ADR 0002 section 10): a key written `{ key, right }` has that
// right; a key whose item field is restricted inherits the field's right, with `derivedFrom: sortKey.restricted`,
// and a written right that disagrees is an error. A list of a union reads the key on every variant: one shared
// restriction is inherited, differing ones are an error. A list whose item is neither an object nor a union of
// objects cannot have its keys' restrictions read, so its keys are refused. A relay route copies its keys without
// their rights (ADR 0002 section 7).
//
// A sort key carries no params, so a right with params, written or inherited, is refused rather than checked
// without them, until the IR has params on a sort key.
//
// The key's subject must be found on the route (ADR 0003 section 6): the resolved scope of a scope right, the
// route's default subject (its nearest member id) for a resource right. A resource right whose id schema is a
// property of the list item is refused: the route's subject is then a parent's id, not each item's, and the
// parent's right would release the order of items it does not cover.

/** The right and its derivation for each sort key of the route, by index; empty for a route without keys. */
export type AccessRightsSortKeyRights = ReadonlyMap<
  number,
  { readonly right: string; readonly derivedFrom?: IrWriter.DerivedFrom }
>;

export interface AccessRightsSortKeysInput {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
}

const LIST_SHAPES: readonly string[] = ["page", "list"];

type Rights = Map<number, { right: string; derivedFrom?: IrWriter.DerivedFrom }>;

export function accessRightsSortKeyRights(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  { route, scopes, schemas }: AccessRightsSortKeysInput,
): AccessRightsSortKeyRights {
  const rights: Rights = new Map();
  const { operation } = route;

  if (route.node.kind === "relay" || operation.paging === undefined) return rights;

  const items = itemObjectsOf(route, schemas);
  const keyPointer = (sortKey: PassReadonly<IrWriter.SortKey>) =>
    sortKey.origin?.pointer ?? route.node.pointer;

  if (items === undefined) {
    for (const sortKey of operation.paging.sortKeys)
      reporter.error({
        rule: "sort-key-right",
        message: `sort key '${accessRightsQuoted(sortKey.key)}' of route '${route.id}' sorts a list whose item is neither an object nor a union of objects, so its field's restriction cannot be read`,
        fix: "remove the key from 'sortable', or list an object schema",
        pointer: keyPointer(sortKey),
      });

    return rights;
  }

  for (const [index, sortKey] of operation.paging.sortKeys.entries()) {
    const use: KeyUse = { route, scopes, items, key: sortKey.key, pointer: keyPointer(sortKey) };
    const right = keyRight(context, reporter, catalogues, checks, use, sortKey);

    if (right !== undefined && keySubjectFound(context, reporter, catalogues, use, right.right))
      rights.set(index, right);
  }

  return rights;
}

interface KeyUse {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  /** The list item's objects: the item itself, or each variant of a union item. */
  readonly items: readonly AccessRightsObjectSchema[];
  readonly key: string;
  /** Where the key is written. */
  readonly pointer: string;
}

function keyRight(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  use: KeyUse,
  sortKey: PassReadonly<IrWriter.SortKey>,
): { right: string; derivedFrom?: IrWriter.DerivedFrom } | undefined {
  const restriction = keyRestriction(reporter, use);
  const written = writtenRight(context, reporter, catalogues, sortKey);

  if (written === "refused" || restriction === "refused") return undefined;

  if (restriction === undefined)
    return written === undefined ? undefined : { right: written.right };

  const inherited = inheritedRight(context, reporter, catalogues, checks, use, restriction);

  if (inherited === undefined) return undefined;

  if (written !== undefined && written.right !== inherited.right) {
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${accessRightsQuoted(use.key)}' of route '${use.route.id}' is given right '${accessRightsQuoted(written.right)}', but its field is restricted to '${accessRightsQuoted(inherited.right)}'`,
      fix: `remove the key's 'right', or write '${accessRightsQuoted(inherited.right)}'`,
      pointer: written.pointer,
      related: [
        {
          pointer: accessRightsRestrictionOrigin(restriction).pointer,
          message: `the field is restricted to '${accessRightsQuoted(inherited.right)}' here`,
        },
      ],
    });

    return undefined;
  }

  return inherited;
}

// The item objects of a list: the body of its page or list response, a reference to an object or to a union whose
// variants are all objects; undefined for any other item.
function itemObjectsOf(
  route: AccessRightsRoute,
  schemas: PassReadonly<DraftIR["schemas"]>,
): AccessRightsObjectSchema[] | undefined {
  const body = (route.operation.responses ?? []).find((response) =>
    LIST_SHAPES.includes(response.shape),
  )?.body;

  if (body?.kind !== "ref") return undefined;

  const schemaOf = (id: string) => (Object.hasOwn(schemas, id) ? schemas[id] : undefined);
  const item = schemaOf(body.schema);

  if (item?.kind === "object") return [item];

  if (item?.kind !== "union") return undefined;

  const variants = item.variants.map((variant) => schemaOf(variant.schema));
  const objects = variants.filter((variant) => variant?.kind === "object");

  return objects.length === variants.length ? objects : undefined;
}

// The restriction of the key's field on every item object: none, the one they share, or "refused" when they differ.
function keyRestriction(
  reporter: AccessRightsReporter,
  { route, items, key, pointer }: KeyUse,
): PassReadonly<IrWriter.FieldRestriction> | "refused" | undefined {
  const restrictions = items.flatMap((item) => {
    const restriction = item.properties.find((property) => property.name === key)?.restrictedTo;

    return restriction === undefined ? [] : [restriction];
  });
  const [first, ...others] = restrictions;
  const sameAsFirst = (other: PassReadonly<IrWriter.FieldRestriction>) =>
    first !== undefined &&
    other.right === first.right &&
    pipelineCanonical(other.params) === pipelineCanonical(first.params);

  if (others.every(sameAsFirst)) return first;

  reporter.error({
    rule: "sort-key-right",
    message: `sort key '${accessRightsQuoted(key)}' of route '${route.id}' sorts a union whose variants restrict its field differently, so the key has no one right`,
    fix: "give the field the same restrictedTo in every variant, or remove the key from 'sortable'",
    pointer,
    related: restrictions.map((restriction) => ({
      pointer: accessRightsRestrictionOrigin(restriction).pointer,
      message: `the field is restricted to '${accessRightsQuoted(restriction.right)}' here`,
    })),
  });

  return "refused";
}

// The right a sortable entry writes (`{ key, right }`), checked against the rights catalogue; a right with params
// is refused, since a sort key carries none.
function writtenRight(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  sortKey: PassReadonly<IrWriter.SortKey>,
): { readonly right: string; readonly pointer: string } | "refused" | undefined {
  if (sortKey.origin === undefined) return undefined;

  const entry = pipelineJsonAtPointer(context.raw.merged, sortKey.origin.pointer);
  const right = accessRightsString(entry, "right");

  if (right === undefined) return undefined;

  const pointer = pipelinePointerBelow(sortKey.origin.pointer, "right");
  const declared = catalogues.rights.get(right);

  if (declared !== undefined && declared.params === undefined) return { right, pointer };

  if (declared !== undefined)
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${accessRightsQuoted(sortKey.key)}' is given right '${accessRightsQuoted(right)}', which declares params, and a sort key's right carries no params`,
      fix: "give the key a right without params, or remove its 'right'",
      pointer,
    });
  else if (!catalogues.declared.rights.has(right))
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${accessRightsQuoted(sortKey.key)}' is given right '${accessRightsQuoted(right)}', which the rights catalogue does not declare`,
      fix: "declare the right in 'rights', or name a declared one",
      pointer,
    });

  return "refused";
}

function inheritedRight(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  { route, key, pointer }: KeyUse,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): { readonly right: string; readonly derivedFrom: IrWriter.DerivedFrom } | undefined {
  const checked = accessRightsCheckRestriction(context, reporter, catalogues, checks, restriction);

  if (checked === undefined) return undefined;

  const origin = accessRightsRestrictionOrigin(restriction);

  if (checked.params !== undefined) {
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${accessRightsQuoted(key)}' of route '${route.id}' inherits right '${accessRightsQuoted(checked.right.id)}' with params from its field, and a sort key's right carries no params`,
      fix: "remove the key from 'sortable', or restrict the field to a right without params",
      pointer,
      related: [{ pointer: origin.pointer, message: "the field's restriction with params" }],
    });

    return undefined;
  }

  return {
    right: checked.right.id,
    derivedFrom: { derivation: "sortKey.restricted", from: [pipelineCopy(origin)] },
  };
}

function keySubjectFound(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes, items, key, pointer }: KeyUse,
  rightId: string,
): boolean {
  const right = catalogues.rights.get(rightId);

  if (right === undefined)
    throw new Error(`sort key '${key}' has right '${rightId}', which is not declared`);

  const unresolved = () =>
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${accessRightsQuoted(key)}' of route '${route.id}' has right '${accessRightsQuoted(right.id)}', whose subject the route does not resolve`,
      fix: "remove the key from 'sortable', or restrict its field to a right whose subject the route resolves",
      pointer,
    });

  switch (right.subject.kind) {
    case "none":
      return true;
    case "scope": {
      const scope = right.subject.scope;

      // The right's scope is refused: its declaration has the error, so a use adds none.
      if (!catalogues.scopes.has(scope) || scopes.some((resolved) => resolved.scope === scope))
        return true;

      unresolved();

      return false;
    }

    case "resource":
      break;
  }

  const idSchema = accessRightsIdSchemaOf(catalogues, right, right.subject);

  if (accessRightsDefaultMemberId(context, route.node, idSchema).kind !== "found") {
    unresolved();

    return false;
  }

  const item = items.find((object) =>
    object.properties.some((property) =>
      accessRightsSameSchema(accessRightsPropertySchema(context, property), idSchema),
    ),
  );

  if (item === undefined) return true;

  reporter.error({
    rule: "sort-key-right",
    message: `sort key '${accessRightsQuoted(key)}' of route '${route.id}' has resource right '${accessRightsQuoted(right.id)}', whose id schema is a property of the list item '${accessRightsQuoted(item.id)}', so the key would be checked against the route's subject, not each item's`,
    fix: "restrict the key's field to a scope right or a right without subject, or remove the key from 'sortable'",
    pointer,
  });

  return false;
}
