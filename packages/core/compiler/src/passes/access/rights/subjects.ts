import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelineIsJsonObject,
  pipelineJsonAtPointer,
  pipelinePointerBelow,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { accessRightsMember, accessRightsSchemaName } from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import type { AccessRightsRoute } from "./routes.js";
import { type AccessRightsContext, accessRightsTypeUse } from "./schema-use.js";
import { accessRightsSourceText, accessRightsValueSource } from "./source.js";

// The subject of a right requirement (ADR 0002 section 9, SCN-062): a resource subject defaults to the member id
// of the nearest collection whose schema is the right's id schema, else `subject` is required, and a written
// source's schema must equal the id schema; a scope subject takes the route's resolved scope. A subject is a
// required value: an optional query field or header, or the principal of a route an anonymous caller reaches, is
// refused.
//
// Two schemas are equal when both name the same schema, or both are inline with the same canonical shape; a named
// schema never equals an inline one. `ChannelId` and `TaskId` compile to one uuid type use but are different ids,
// so a `tasks.update` right never defaults to a channel id.

/** The schema a value source reads: its type use, and the schema it names when the position names one. */
export interface AccessRightsSourceSchema {
  readonly use: IrWriter.TypeUse;
  readonly name?: string;
  /** Set on an optional query field or header, which a caller may omit. */
  readonly optional?: true;
}

/** A member id of a collection whose member scope holds the route. */
interface MemberId {
  readonly name: string;
  readonly pointer: string;
  readonly collection: TreeNode;
}

type DefaultSubject =
  | { readonly kind: "found"; readonly source: IrWriter.ValueSource }
  | { readonly kind: "ambiguous"; readonly candidates: readonly MemberId[] }
  | { readonly kind: "none" };

export interface AccessRightsSubjectInput {
  readonly route: AccessRightsRoute;
  readonly right: IrWriter.Right;
  /** The schema the right's resource id names (`TaskId`), when it names one. */
  readonly idName: string | undefined;
  readonly scopes: readonly IrWriter.OperationScope[];
  /** The right's scope is declared but refused: its declaration has the error, so a use adds none. */
  readonly scopeRefused: boolean;
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
        message: `right '${right.id}' has no subject, but this requirement reads one from ${accessRightsQuoted(written.text)}`,
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
  { route, right, scopes, scopeRefused, written, usePointer }: AccessRightsSubjectInput,
  scope: string,
): AccessRightsSubjectResult {
  if (scopeRefused) return undefined;

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
    message: `right '${right.id}' takes the route's scope '${scope}' as its subject, not ${accessRightsQuoted(written.text)}`,
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
  const { route, right, idName, written } = input;
  const expected: AccessRightsSourceSchema = {
    use: subject.idSchema,
    ...(idName === undefined ? {} : { name: idName }),
  };

  if (written === undefined) return defaultedSubject(context, reporter, input, expected);

  const source = accessRightsValueSource(written.text);

  if (source?.in === "principal" && route.access !== "identity") {
    reporter.error({
      rule: "requirement-subject",
      message: `the subject ${accessRightsQuoted(written.text)} of right '${right.id}' reads the principal, which is null for an anonymous caller of ${route.access === "public" ? "public" : "optional-auth"} route '${route.id}'`,
      fix: "read the subject from a request value, or require the right on an identified route",
      pointer: written.pointer,
    });

    return undefined;
  }

  const found = source === undefined ? undefined : sourceSchema(context, input, source);

  if (source === undefined || found === undefined) {
    reporter.error({
      rule: "requirement-subject",
      message: `the subject ${accessRightsQuoted(written.text)} of right '${right.id}' names nothing route '${route.id}' reads`,
      fix: "read the subject from a parameter, header, principal field or scope of the route",
      pointer: written.pointer,
    });

    return undefined;
  }

  if (found.optional === true) {
    reporter.error({
      rule: "requirement-subject",
      message: `the subject ${accessRightsQuoted(written.text)} of right '${right.id}' is an optional field, which a caller of route '${route.id}' may omit; the subject must be a required field`,
      fix: "make the field required, or read the subject from a required one",
      pointer: written.pointer,
    });

    return undefined;
  }

  if (accessRightsSameSchema(found, expected)) return { subject: { source, defaulted: false } };
  reporter.error({
    rule: "requirement-subject",
    message: `the subject ${accessRightsQuoted(written.text)} of right '${right.id}' is ${describe(found)}, not the right's id schema ${describe(expected)}`,
    fix: "read the subject from a source whose schema is the right's id schema",
    pointer: written.pointer,
  });

  return undefined;
}

function defaultedSubject(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  { route, right, usePointer }: AccessRightsSubjectInput,
  expected: AccessRightsSourceSchema,
): AccessRightsSubjectResult {
  const defaulted = accessRightsDefaultMemberId(context, route.node, expected);

  if (defaulted.kind === "found") return { subject: { source: defaulted.source, defaulted: true } };

  if (defaulted.kind === "ambiguous") {
    reporter.error({
      rule: "requirement-subject",
      message: `ambiguous default subject: right '${right.id}' on route '${route.id}' could read member id ${defaulted.candidates.map(({ name }) => `'${name}'`).join(" or ")}, each of its id schema`,
      fix: "write the requirement's 'subject', naming one of the member ids",
      pointer: usePointer,
      related: defaulted.candidates.map((candidate) => ({
        pointer: candidate.pointer,
        message: `member id '${candidate.name}' has the right's id schema`,
      })),
    });

    return undefined;
  }

  reporter.error({
    rule: "requirement-subject",
    message: `right '${right.id}' needs a subject on route '${route.id}', and no member id of the route has its id schema`,
    fix: "write the requirement's 'subject', a source whose schema is the right's id schema",
    pointer: usePointer,
  });

  return undefined;
}

export function accessRightsSameSchema(
  found: AccessRightsSourceSchema,
  expected: AccessRightsSourceSchema,
): boolean {
  if (found.name !== undefined || expected.name !== undefined) return found.name === expected.name;

  return pipelineCanonical(found.use) === pipelineCanonical(expected.use);
}

const describe = (schema: AccessRightsSourceSchema): string =>
  schema.name === undefined ? `an inline ${schema.use.kind} schema` : `'${schema.name}'`;

/** The member ids of the collections whose member scope holds `node`, nearest first, each in written order. */
function memberIds(node: TreeNode): MemberId[] {
  const ids: MemberId[] = [];

  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    const collection = at.parent;

    if (at.kind !== "scope" || at.name !== "member" || collection === undefined) continue;

    const written = accessRightsMember(collection.settings, "id");

    if (!pipelineIsJsonObject(written)) continue;

    for (const name of Object.keys(written))
      ids.push({ name, pointer: pipelinePointerBelow(collection.pointer, "id", name), collection });
  }

  return ids;
}

// The nearest collection with a member id of the expected schema decides: one such id is the default, two or more
// are ambiguous.
export function accessRightsDefaultMemberId(
  context: AccessRightsContext,
  node: TreeNode,
  expected: AccessRightsSourceSchema,
): DefaultSubject {
  const ids = memberIds(node);

  for (const collection of new Set(ids.map((id) => id.collection))) {
    const fitting = ids.filter(
      (id) =>
        id.collection === collection &&
        accessRightsSameSchema(positionSchema(context, id.pointer), expected),
    );
    const [only, ...others] = fitting;

    if (only === undefined) continue;

    if (others.length === 0) return { kind: "found", source: { in: "path", name: only.name } };

    return { kind: "ambiguous", candidates: fitting };
  }

  return { kind: "none" };
}

// The schema written at a raw position, compiled by the schema service.
function positionSchema(context: AccessRightsContext, pointer: string): AccessRightsSourceSchema {
  const use = accessRightsTypeUse(context, pointer, "input");
  const name = accessRightsSchemaName(pipelineJsonAtPointer(context.raw.merged, pointer));

  return name === undefined ? { use } : { use, name };
}

function sourceSchema(
  context: AccessRightsContext,
  input: AccessRightsSubjectInput,
  source: IrWriter.ValueSource,
): AccessRightsSourceSchema | undefined {
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
        ? positionSchema(context, pipelinePointerBelow("/scopes", name, "id"))
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
): AccessRightsSourceSchema | undefined {
  const memberId = memberIds(node).find((id) => id.name === name);

  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    if (memberId !== undefined && at === memberId.collection)
      return positionSchema(context, memberId.pointer);
    const declared = accessRightsMember(at.settings, "pathParams");

    if (accessRightsMember(declared, name) !== undefined)
      return positionSchema(context, pipelinePointerBelow(at.pointer, "pathParams", name));
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
): AccessRightsSourceSchema | undefined {
  const entries = context.inherited(node, setting)?.entries ?? [];

  for (const entry of [...entries].reverse()) {
    const key = entry.key;

    if (key === undefined) continue;
    const optional = key.endsWith(OPTIONAL_FIELD);
    const field = optional ? key.slice(0, -OPTIONAL_FIELD.length) : key;

    if (!matches(field)) continue;

    const schema = positionSchema(context, pipelinePointerBelow(entry.node.pointer, setting, key));

    return optional ? { ...schema, optional: true } : schema;
  }

  return undefined;
}

// A principal field (`principal.userId`, `principal.profile.id`), through the object schemas of the principal.
function principalSchema(
  context: AccessRightsContext,
  { route, schemas }: AccessRightsSubjectInput,
  path: string,
): AccessRightsSourceSchema | undefined {
  if (route.identity === undefined) return undefined;
  const identity = accessRightsMember(context.raw.merged.identities, route.identity);
  let schemaId = accessRightsSchemaName(accessRightsMember(identity, "principal"));
  let found: AccessRightsSourceSchema | undefined;
  let optional = false;

  for (const field of path.split(".")) {
    const schema = schemaId === undefined ? undefined : schemas[schemaId];

    if (schema?.kind !== "object") return undefined;
    const property = schema.properties.find((candidate) => candidate.name === field);

    if (property === undefined) return undefined;

    optional ||= property.optional;
    found = accessRightsPropertySchema(context, property);
    schemaId = property.type.kind === "ref" ? property.type.schema : undefined;
  }

  return found !== undefined && optional ? { ...found, optional: true } : found;
}

/** The schema of an object property: its type use, and the schema its written position names, if any. */
export function accessRightsPropertySchema(
  context: AccessRightsContext,
  property: PassReadonly<IrWriter.Property>,
): AccessRightsSourceSchema {
  const use = pipelineCopy(property.type);
  const name =
    property.origin.layer === "core"
      ? undefined
      : accessRightsSchemaName(pipelineJsonAtPointer(context.raw.merged, property.origin.pointer));

  return name === undefined ? { use } : { use, name };
}
