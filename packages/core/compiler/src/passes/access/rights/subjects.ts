import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCopy,
  type TreeNode,
} from "../../../pipeline/seam.js";
import {
  accessRightsAt,
  accessRightsCanonical,
  accessRightsIsObject,
  accessRightsMember,
  accessRightsPointer,
  accessRightsSchemaName,
} from "./read.js";
import type { AccessRightsReporter } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import { type AccessRightsContext, accessRightsTypeUse } from "./schema-use.js";
import { accessRightsSourceText, accessRightsValueSource } from "./source.js";

// The subject of a right requirement (ADR 0002 section 9, SCN-062): a resource subject defaults to the nearest
// member id whose schema is the right's id schema, else `subject` is required, and a written source's schema must
// equal the id schema; a scope subject takes the route's resolved scope.
//
// Two schemas are equal when their type uses are, and, when both positions name a schema, when they name the same
// one: `ChannelId` and `TaskId` compile to one uuid type use but are different ids, so a `tasks.update` right
// never defaults to a channel id.

/** The schema a value source reads: its type use, and the schema it names when the position names one. */
interface SourceSchema {
  readonly use: IrWriter.TypeUse;
  readonly name?: string;
}

export interface AccessRightsSubjectInput {
  readonly route: AccessRightsRoute;
  readonly right: IrWriter.Right;
  /** The schema the right's resource id names (`TaskId`), when it names one. */
  readonly idName: string | undefined;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
  /** The written `subject`, with the pointer of the requirement item that holds it. */
  readonly written?: { readonly text: string; readonly pointer: string };
  /** Where the requirement is used on this route, for the route-dependent errors. */
  readonly usePointer: string;
}

/** The subject of a requirement: absent for a right without subject, undefined after an error. */
export type AccessRightsSubjectResult =
  | { readonly subject?: IrWriter.RequirementSubject }
  | undefined;

export function accessRightsSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  input: AccessRightsSubjectInput,
): AccessRightsSubjectResult {
  const { right, written } = input;
  switch (right.subject.kind) {
    case "none":
      if (written === undefined) return {};
      reporter.error({
        rule: "requirement-subject",
        message: `right '${right.id}' has no subject, but this requirement reads one from ${written.text}`,
        fix: "remove 'subject', or declare a subject on the right",
        pointer: written.pointer,
      });
      return undefined;
    case "scope":
      return scopeSubject(reporter, input, right.subject.scope);
    case "resource":
      return resourceSubject(context, reporter, input, right.subject);
  }
}

function scopeSubject(
  reporter: AccessRightsReporter,
  { route, right, scopes, written, usePointer }: AccessRightsSubjectInput,
  scope: string,
): AccessRightsSubjectResult {
  if (!scopes.some((resolved) => resolved.scope === scope)) {
    reporter.error({
      rule: "requirement-subject",
      message: `right '${right.id}' is checked against scope '${scope}', which route '${route.id}' does not resolve`,
      fix: `enter scope '${scope}' on the route or an ancestor, or require the right elsewhere`,
      pointer: usePointer,
    });
    return undefined;
  }

  const source: IrWriter.ValueSource = { in: "scope", name: scope };
  if (written === undefined) return { subject: { source, defaulted: true } };
  if (written.text === accessRightsSourceText(source))
    return { subject: { source, defaulted: false } };

  reporter.error({
    rule: "requirement-subject",
    message: `right '${right.id}' takes the route's scope '${scope}' as its subject, not ${written.text}`,
    fix: `remove 'subject', or write 'scope.${scope}'`,
    pointer: written.pointer,
  });
  return undefined;
}

function resourceSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  input: AccessRightsSubjectInput,
  subject: IrWriter.ResourceSubject,
): AccessRightsSubjectResult {
  const { route, right, idName, written, usePointer } = input;
  const expected: SourceSchema = {
    use: subject.idSchema,
    ...(idName === undefined ? {} : { name: idName }),
  };

  if (written === undefined) {
    const defaulted = defaultMemberId(context, route.node, expected);
    if (defaulted !== undefined) return { subject: { source: defaulted, defaulted: true } };
    reporter.error({
      rule: "requirement-subject",
      message: `right '${right.id}' needs a subject on route '${route.id}', and no member id of the route has its id schema`,
      fix: "write the requirement's 'subject', a source whose schema is the right's id schema",
      pointer: usePointer,
    });
    return undefined;
  }

  const source = accessRightsValueSource(written.text);
  const found = source === undefined ? undefined : sourceSchema(context, input, source);
  if (source === undefined || found === undefined) {
    reporter.error({
      rule: "requirement-subject",
      message: `the subject ${written.text} of right '${right.id}' names nothing route '${route.id}' reads`,
      fix: "read the subject from a parameter, header, principal field or scope of the route",
      pointer: written.pointer,
    });
    return undefined;
  }

  if (sameSchema(found, expected)) return { subject: { source, defaulted: false } };
  reporter.error({
    rule: "requirement-subject",
    message: `the subject ${written.text} of right '${right.id}' is ${describe(found)}, not the right's id schema ${describe(expected)}`,
    fix: "read the subject from a source whose schema is the right's id schema",
    pointer: written.pointer,
  });
  return undefined;
}

function sameSchema(found: SourceSchema, expected: SourceSchema): boolean {
  if (accessRightsCanonical(found.use) !== accessRightsCanonical(expected.use)) return false;
  return found.name === undefined || expected.name === undefined || found.name === expected.name;
}

const describe = (schema: SourceSchema): string =>
  schema.name === undefined ? `a ${schema.use.kind} use` : `'${schema.name}'`;

/** The member ids of the collections whose member scope holds `node`, nearest first, each in written order. */
function memberIds(node: TreeNode): { name: string; pointer: string; collection: TreeNode }[] {
  const ids: { name: string; pointer: string; collection: TreeNode }[] = [];
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    const collection = at.parent;
    if (at.kind !== "scope" || at.name !== "member" || collection === undefined) continue;

    const written = accessRightsMember(collection.settings, "id");
    if (!accessRightsIsObject(written)) continue;
    for (const name of Object.keys(written))
      ids.push({ name, pointer: accessRightsPointer(collection.pointer, "id", name), collection });
  }
  return ids;
}

function defaultMemberId(
  context: AccessRightsContext,
  node: TreeNode,
  expected: SourceSchema,
): IrWriter.ValueSource | undefined {
  for (const id of memberIds(node)) {
    const found = positionSchema(context, id.pointer);
    if (sameSchema(found, expected)) return { in: "path", name: id.name };
  }
  return undefined;
}

// The schema written at a raw position, compiled by the schema service.
function positionSchema(context: AccessRightsContext, pointer: string): SourceSchema {
  const use = accessRightsTypeUse(context, pointer, "input");
  const name = accessRightsSchemaName(accessRightsAt(context.raw.merged, pointer));
  return name === undefined ? { use } : { use, name };
}

function sourceSchema(
  context: AccessRightsContext,
  input: AccessRightsSubjectInput,
  source: IrWriter.ValueSource,
): SourceSchema | undefined {
  const name = source.name ?? "";
  switch (source.in) {
    case "path":
      return pathSchema(context, input.route.node, name);
    case "query":
      return fieldsSchema(context, input.route.node, "query", (key) => key === name);
    case "header":
      return fieldsSchema(
        context,
        input.route.node,
        "headers",
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
    case "scope":
      return input.scopes.some((scope) => scope.scope === name)
        ? positionSchema(context, accessRightsPointer("/scopes", name, "id"))
        : undefined;
    case "principal":
      return principalSchema(context, input, name);
    default:
      return undefined;
  }
}

// A path parameter: a member id, or a `pathParams` entry of the route or an ancestor, the nearest first.
function pathSchema(
  context: AccessRightsContext,
  node: TreeNode,
  name: string,
): SourceSchema | undefined {
  const memberId = memberIds(node).find((id) => id.name === name);
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    if (memberId !== undefined && at === memberId.collection)
      return positionSchema(context, memberId.pointer);
    const declared = accessRightsMember(at.settings, "pathParams");
    if (accessRightsMember(declared, name) !== undefined)
      return positionSchema(context, accessRightsPointer(at.pointer, "pathParams", name));
  }
  return undefined;
}

const OPTIONAL_FIELD = "?";

// A query field or request header the route declares, in a fields map of the route or an ancestor.
function fieldsSchema(
  context: AccessRightsContext,
  node: TreeNode,
  setting: "query" | "headers",
  matches: (key: string) => boolean,
): SourceSchema | undefined {
  const entries = context.inherited(node, setting)?.entries ?? [];
  for (const entry of [...entries].reverse()) {
    const key = entry.key;
    if (key === undefined) continue;
    const field = key.endsWith(OPTIONAL_FIELD) ? key.slice(0, -OPTIONAL_FIELD.length) : key;
    if (matches(field))
      return positionSchema(context, accessRightsPointer(entry.node.pointer, setting, key));
  }
  return undefined;
}

// A principal field (`principal.userId`, `principal.profile.id`), through the object schemas of the principal.
function principalSchema(
  context: AccessRightsContext,
  { route, schemas }: AccessRightsSubjectInput,
  path: string,
): SourceSchema | undefined {
  if (route.access === "public" || route.identity === undefined) return undefined;
  const identity = accessRightsMember(context.raw.merged.identities, route.identity);
  let schemaId = accessRightsSchemaName(accessRightsMember(identity, "principal"));
  let found: SourceSchema | undefined;

  for (const field of path.split(".")) {
    const schema = schemaId === undefined ? undefined : schemas[schemaId];
    if (schema?.kind !== "object") return undefined;
    const property = schema.properties.find((candidate) => candidate.name === field);
    if (property === undefined) return undefined;

    const name =
      property.origin.layer === "core"
        ? undefined
        : accessRightsSchemaName(accessRightsAt(context.raw.merged, property.origin.pointer));
    const use = pipelineCopy(property.type);
    found = name === undefined ? { use } : { use, name };
    schemaId = property.type.kind === "ref" ? property.type.schema : undefined;
  }
  return found;
}
