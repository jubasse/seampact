import type { IrWriter } from "@seampact/spec/ir";
import { splitName } from "@seampact/spec/naming";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelineIsJsonObject,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import {
  type AccessRightsCatalogues,
  accessRightsCheckName,
  accessRightsRightErrors,
} from "./catalogues.js";
import {
  type AccessRightsRawObject,
  type AccessRightsRawValue,
  accessRightsMember,
  accessRightsOriginOf,
  accessRightsSchemaName,
  accessRightsString,
  accessRightsStrings,
} from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import {
  type AccessRightsApi,
  type AccessRightsRoute,
  accessRightsResourceOf,
  accessRightsScopeOf,
} from "./routes.js";
import { type AccessRightsContext, accessRightsTypeUse } from "./schema-use.js";

// The pack derivation entries (ADR 0002 section 2, ADR 0008): a selector over routes, and the effects this half
// owns, `declareRight` (a right in the catalogue) and `require` (a requirement first in the route's `requires`).
// Every element an entry produces carries `derivedFrom` with the derivation `pack.<pack>.<entry>`.

export interface AccessRightsDeriveEntry {
  /** The entry's pointer in the merged raw tree, `/derive/<n>`. */
  readonly pointer: string;
  readonly entry: string;
  readonly derivation: string;
  readonly settings: AccessRightsRawObject;
}

const PACK_LAYER = "pack:";

/**
 * The derive entries of the api, in application order: the packs in order, each pack's entries in written order.
 * Each pack must be one tree.nodes recorded in `packs`, since the derivation id names it.
 */
export function accessRightsDeriveEntries(
  context: AccessRightsContext,
  packs: PassReadonly<DraftIR["packs"]>,
): AccessRightsDeriveEntry[] {
  const written = accessRightsMember(context.raw.merged, "derive");

  if (!Array.isArray(written)) return [];

  const entries: AccessRightsDeriveEntry[] = [];

  for (const [index, settings] of written.entries()) {
    if (!pipelineIsJsonObject(settings)) continue;
    const pointer = pipelinePointerBelow("/derive", index);
    const layer = context.origin(pointer)?.layer ?? "";

    if (!layer.startsWith(PACK_LAYER))
      throw new Error(
        `the derive entry at ${pointer} comes from layer '${layer}', which is no pack`,
      );

    const pack = layer.slice(PACK_LAYER.length);

    if (!packs.some((applied) => applied.name === pack))
      throw new Error(
        `the derive entry at ${pointer} comes from pack '${pack}', which tree.nodes did not record in packs`,
      );

    const entry = accessRightsString(settings, "entry");

    if (entry === undefined) throw new Error(`the derive entry at ${pointer} has no 'entry' name`);
    entries.push({ pointer, entry, derivation: `pack.${pack}.${entry}`, settings });
  }

  return entries;
}

/** True when the route matches every criterion of the entry's selector (ADR 0002 section 2). */
export function accessRightsSelects(
  context: AccessRightsContext,
  entry: AccessRightsDeriveEntry,
  route: AccessRightsRoute,
  api: AccessRightsApi,
): boolean {
  const select = accessRightsMember(entry.settings, "select");
  const accepts = (criterion: string, value: string | undefined): boolean => {
    if (accessRightsMember(select, criterion) === undefined) return true;

    return value !== undefined && accessRightsStrings(select, criterion).includes(value);
  };

  const tags = (context.inherited(route.node, "tags")?.entries ?? []).map((tag) => tag.value);
  const tagAccepted =
    accessRightsMember(select, "tag") === undefined ||
    accessRightsStrings(select, "tag").some((tag) => tags.includes(tag));

  return (
    accepts("op", route.operation.op) &&
    accepts("access", route.operation.safe === true ? "read" : "write") &&
    accepts("apiKind", api.kind) &&
    accepts("identity", route.access === "public" ? undefined : route.identity) &&
    tagAccepted
  );
}

const RESOURCE_SLOT = "{resource}";
const OP_SLOT = "{op}";

/**
 * A template over `{resource}` (the collection or single the route belongs to) and `{op}` (the `ops` name, else
 * the route's name), expanded for a route; undefined after an error.
 */
export function accessRightsExpand(
  reporter: AccessRightsReporter,
  template: { text: string; pointer: string },
  route: AccessRightsRoute,
): string | undefined {
  const resource = accessRightsResourceOf(route.node)?.name;

  if (resource === undefined && template.text.includes(RESOURCE_SLOT)) {
    reporter.error({
      rule: "pack-template",
      message: `the template '${accessRightsQuoted(template.text)}' reads {resource}, and route '${route.id}' belongs to no collection or single`,
      fix: "narrow the entry's selector to routes of a collection or single, or drop {resource}",
      pointer: template.pointer,
    });

    return undefined;
  }

  const op = route.operation.op ?? route.node.name;

  // Function replacers, so a `$` in a name is never read as a replacement pattern.
  return template.text
    .replaceAll(RESOURCE_SLOT, () => resource ?? "")
    .replaceAll(OP_SLOT, () => op);
}

interface DerivedRightInput {
  readonly entry: AccessRightsDeriveEntry;
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
}

/**
 * Applies an entry's `declareRight` to a route: the right its name template gives, added to the catalogue with
 * `derivedFrom`, or, when the catalogue already declares that name, checked against the subject the entry gives.
 */
export function accessRightsDeclareRight(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  input: DerivedRightInput,
): void {
  const { entry, route } = input;
  const declareRight = accessRightsMember(entry.settings, "declareRight");
  const pointer = pipelinePointerBelow(entry.pointer, "declareRight");
  const text = accessRightsString(declareRight, "name");

  if (text === undefined) throw new Error(`the declareRight at ${pointer} has no 'name' template`);
  const id = accessRightsExpand(
    reporter,
    { text, pointer: pipelinePointerBelow(pointer, "name") },
    route,
  );

  if (id === undefined) return;

  const derived = derivedSubject(context, reporter, { ...input, declareRight, pointer });

  if (derived === undefined) {
    if (!catalogues.rights.has(id)) catalogues.declared.rights.add(id);

    return;
  }

  const present = catalogues.rights.get(id);

  if (present !== undefined) {
    checkSameSubject(reporter, { id, present, derived: derived.subject, pointer, route });

    if (present.derivedFrom?.derivation === entry.derivation)
      present.derivedFrom.from.push(pipelineCopy(route.node.origin));

    return;
  }

  if (catalogues.declared.rights.has(id)) return;

  const named = accessRightsCheckName(reporter, {
    id,
    codeName: undefined,
    pointer,
    rightPattern: catalogues.rightPattern,
  });

  if (!named) {
    catalogues.declared.rights.add(id);

    return;
  }

  catalogues.rights.set(id, {
    id,
    subject: derived.subject,
    errors: accessRightsRightErrors(declareRight, catalogues.forbiddenCode),
    docs: {},
    extensions: {},
    origin: accessRightsOriginOf(context, pointer),
    derivedFrom: {
      derivation: entry.derivation,
      from: [accessRightsOriginOf(context, pointer), pipelineCopy(route.node.origin)],
    },
  });

  if (derived.idName !== undefined) catalogues.rightIdNames.set(id, derived.idName);
}

function checkSameSubject(
  reporter: AccessRightsReporter,
  options: {
    id: string;
    present: IrWriter.Right;
    derived: IrWriter.RightSubject;
    pointer: string;
    route: AccessRightsRoute;
  },
): void {
  const { id, present, derived, pointer, route } = options;

  if (pipelineCanonical(present.subject) === pipelineCanonical(derived)) return;

  // A right an entry derived has no place of its own in the merged tree; a declared one does.
  reporter.error({
    rule: "pack-right",
    message: `right '${id}' has a ${present.subject.kind} subject, and the entry derives another ${derived.kind} subject for route '${route.id}'`,
    fix: "give the right the subject the entry derives, or narrow the entry's selector",
    pointer,
    related:
      present.derivedFrom === undefined
        ? [{ pointer: pipelinePointerBelow("/rights", id), message: "the right is declared here" }]
        : [],
  });
}

// `subject.member` on a route of a collection's member scope, `subject.collection` elsewhere; absent is `none`.
function derivedSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  input: DerivedRightInput & { declareRight: AccessRightsRawValue | undefined; pointer: string },
): { subject: IrWriter.RightSubject; idName?: string } | undefined {
  const { route, scopes, schemas, declareRight, pointer } = input;
  const subject = accessRightsMember(declareRight, "subject");
  const at = accessRightsScopeOf(route.node);

  if (at?.scope.name === "member") {
    if (accessRightsString(subject, "member") !== "resource") return { subject: { kind: "none" } };

    return resourceSubject(context, reporter, { at: at.collection, schemas, pointer, route });
  }

  if (accessRightsString(subject, "collection") !== "innermostScope")
    return { subject: { kind: "none" } };
  const innermost = scopes[scopes.length - 1];

  // ADR 0008: the innermost scope when the route has one, none otherwise.
  if (innermost === undefined) return { subject: { kind: "none" } };

  return { subject: { kind: "scope", scope: innermost.scope } };
}

// The item schema of the collection with its member id (ADR 0002 section 2, `subject.member: resource`).
function resourceSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  options: {
    at: AccessRightsRoute["node"];
    schemas: PassReadonly<DraftIR["schemas"]>;
    pointer: string;
    route: AccessRightsRoute;
  },
): { subject: IrWriter.RightSubject; idName?: string } | undefined {
  const { at, schemas, pointer, route } = options;
  const ids = Object.keys(accessRightsMember(at.settings, "id") ?? {});
  const item = accessRightsMember(at.settings, "item");
  const [idKey] = ids;

  if (ids.length !== 1 || idKey === undefined || item === undefined) {
    reporter.error({
      rule: "pack-right",
      message: `the entry derives a resource right for route '${route.id}', and collection '${at.name}' has no item with one member id`,
      fix: "give the collection an 'item' and one 'id', or narrow the entry's selector",
      pointer,
    });

    return undefined;
  }

  const idPointer = pipelinePointerBelow(at.pointer, "id", idKey);
  const idName = accessRightsSchemaName(
    accessRightsMember(accessRightsMember(at.settings, "id"), idKey),
  );

  return {
    subject: {
      kind: "resource",
      type: itemName(context, schemas, item, pipelinePointerBelow(at.pointer, "item")),
      idSchema: accessRightsTypeUse(context, idPointer, "input"),
    },
    ...(idName === undefined ? {} : { idName }),
  };
}

// A named item is its schema name; an inline one takes the name tree.schemas gave its hoisted schema.
function itemName(
  context: AccessRightsContext,
  schemas: PassReadonly<DraftIR["schemas"]>,
  item: AccessRightsRawValue,
  pointer: string,
): IrWriter.Name {
  const name = accessRightsSchemaName(item);

  if (name !== undefined) return { segments: splitName(name), role: "schema" };

  const use = accessRightsTypeUse(context, pointer, "output");
  const hoisted = use.kind === "ref" ? schemas[use.schema] : undefined;

  if (hoisted === undefined || !("name" in hoisted))
    throw new Error(`the schema service answers no named schema for the item at ${pointer}`);

  return pipelineCopy(hoisted.name);
}
