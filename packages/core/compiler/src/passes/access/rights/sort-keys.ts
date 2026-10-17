import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCopy,
  pipelineJsonAtPointer,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import {
  type AccessRightsRestrictionChecks,
  accessRightsCheckRestriction,
  accessRightsIdSchemaOf,
  accessRightsRestrictionOrigin,
} from "./field-rights.js";
import { accessRightsString } from "./read.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import { accessRightsDefaultMemberId } from "./subjects.js";

// The rights of a list's sort keys (FR-23, SCN-067, ADR 0002 section 10): a key written `{ key, right }` has that
// right; a key whose item field is restricted inherits the field's right, with `derivedFrom: sortKey.restricted`,
// and a written right that disagrees is an error. A sort key carries no params, so a key inherited from a
// restriction with params is refused rather than checked without them. A relay route copies its keys without their
// rights (ADR 0002 section 7).
//
// The key's subject must be found on the route (ADR 0003 section 6): the resolved scope of a scope right, the
// route's default subject (its nearest member id) for a resource right.

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

export function accessRightsSortKeyRights(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  { route, scopes, schemas }: AccessRightsSortKeysInput,
): AccessRightsSortKeyRights {
  const rights = new Map<number, { right: string; derivedFrom?: IrWriter.DerivedFrom }>();
  const { operation } = route;

  if (route.node.kind === "relay" || operation.paging === undefined) return rights;

  const item = itemSchemaOf(route, schemas);

  const subjectFound = (key: PassReadonly<IrWriter.SortKey>, right: string): boolean =>
    keySubjectFound(context, reporter, catalogues, {
      route,
      scopes,
      key: key.key,
      pointer: key.origin?.pointer ?? route.node.pointer,
      right,
    });

  for (const [index, sortKey] of operation.paging.sortKeys.entries()) {
    const restriction = item?.properties.find(
      (property) => property.name === sortKey.key,
    )?.restrictedTo;
    const written = writtenRight(context, reporter, catalogues, sortKey);

    if (written === "refused") continue;

    if (restriction === undefined) {
      if (written !== undefined && subjectFound(sortKey, written.right))
        rights.set(index, { right: written.right });
      continue;
    }

    const inherited = inheritedRight(context, reporter, catalogues, checks, {
      route,
      key: sortKey.key,
      pointer: sortKey.origin?.pointer ?? route.node.pointer,
      restriction,
    });

    if (inherited === undefined) continue;

    if (written !== undefined && written.right !== inherited.right) {
      reporter.error({
        rule: "sort-key-right",
        message: `sort key '${sortKey.key}' of route '${route.id}' is given right '${written.right}', but its field is restricted to '${inherited.right}'`,
        fix: `remove the key's 'right', or write '${inherited.right}'`,
        pointer: written.pointer,
        related: [
          {
            pointer: accessRightsRestrictionOrigin(restriction).pointer,
            message: `the field is restricted to '${inherited.right}' here`,
          },
        ],
      });
      continue;
    }

    if (subjectFound(sortKey, inherited.right)) rights.set(index, inherited);
  }

  return rights;
}

// The item schema of a list: the body of its page or list response.
function itemSchemaOf(
  route: AccessRightsRoute,
  schemas: PassReadonly<DraftIR["schemas"]>,
): Extract<PassReadonly<DraftIR["schemas"]>[string], { kind: "object" }> | undefined {
  const body = (route.operation.responses ?? []).find((response) =>
    LIST_SHAPES.includes(response.shape),
  )?.body;

  if (body?.kind !== "ref") return undefined;

  const schema = Object.hasOwn(schemas, body.schema) ? schemas[body.schema] : undefined;

  return schema?.kind === "object" ? schema : undefined;
}

// The right a sortable entry writes (`{ key, right }`), checked against the rights catalogue.
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

  if (catalogues.rights.has(right)) return { right, pointer };

  if (!catalogues.declared.rights.has(right))
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${sortKey.key}' is given right '${right}', which the rights catalogue does not declare`,
      fix: "declare the right in 'rights', or name a declared one",
      pointer,
    });

  return "refused";
}

interface InheritedUse {
  readonly route: AccessRightsRoute;
  readonly key: string;
  /** Where the key is written. */
  readonly pointer: string;
  readonly restriction: PassReadonly<IrWriter.FieldRestriction>;
}

function inheritedRight(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  { route, key, pointer, restriction }: InheritedUse,
): { readonly right: string; readonly derivedFrom: IrWriter.DerivedFrom } | undefined {
  const checked = accessRightsCheckRestriction(context, reporter, catalogues, checks, restriction);

  if (checked === undefined) return undefined;

  const origin = accessRightsRestrictionOrigin(restriction);

  if (checked.params !== undefined) {
    reporter.error({
      rule: "sort-key-right",
      message: `sort key '${key}' of route '${route.id}' inherits right '${checked.right.id}' with params from its field, and a sort key's right carries no params`,
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

interface KeySubjectUse {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly key: string;
  readonly pointer: string;
  readonly right: string;
}

function keySubjectFound(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, scopes, key, pointer, right: rightId }: KeySubjectUse,
): boolean {
  const right = catalogues.rights.get(rightId);

  if (right === undefined)
    throw new Error(`sort key '${key}' has right '${rightId}', which is not declared`);

  switch (right.subject.kind) {
    case "none":
      return true;
    case "scope": {
      const scope = right.subject.scope;

      // The right's scope is refused: its declaration has the error, so a use adds none.
      if (!catalogues.scopes.has(scope) || scopes.some((resolved) => resolved.scope === scope))
        return true;

      break;
    }

    case "resource":
      if (
        accessRightsDefaultMemberId(
          context,
          route.node,
          accessRightsIdSchemaOf(catalogues, right, right.subject),
        ).kind === "found"
      )
        return true;
  }

  reporter.error({
    rule: "sort-key-right",
    message: `sort key '${key}' of route '${route.id}' has right '${right.id}', whose subject the route does not resolve`,
    fix: "remove the key from 'sortable', or restrict its field to a right whose subject the route resolves",
    pointer,
  });

  return false;
}
