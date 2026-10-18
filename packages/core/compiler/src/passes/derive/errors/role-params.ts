import type { IrWriter } from "@seampact/spec/ir";
import {
  DERIVATION_ISSUE_SCHEMA_ID,
  type DerivationRole,
  type DerivationRoleDatum,
  derivationIssueMembers,
} from "../../../derivations/index.js";
import {
  type PassReadonly,
  pipelineIsJsonObject,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import {
  type TemplateSite,
  type TemplateSlot,
  type TemplateSlotKind,
  templateRead,
} from "../../../templates/index.js";
import { quote } from "../../../validate/diagnostics.js";
import type { DeriveErrorsRawValue } from "./read.js";
import type { DeriveErrorsReporter } from "./report.js";

// The params of a role binding (ADR 0002 section 11 "Error roles", docs/ir/07): an authored `params` template read by
// the shared template reader with the role's data as its slots, or the by-name template when none is written. The
// rendered params must validate against the code's params schema whatever the data, so each param's template is
// checked against its type use: a required param gets a value whenever the binding answers (a literal, a datum the
// role always supplies, or an `each` over one), and a template's JSON types fit the use. Role data are flat, so an
// `each` inside another `each`'s `as` is refused.

type Schemas = PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;

type Use = PassReadonly<IrWriter.TypeUse>;

type Template = PassReadonly<IrWriter.Template>;

/** What reading a binding's params gives: refused (each fault reported), or the params template, absent without params. */
export type DeriveErrorsRoleParams =
  | { readonly refused: true }
  | { readonly refused: false; readonly params?: IrWriter.Template };

/** A role binding's params as one reading needs them. */
export interface DeriveErrorsRoleParamsSite {
  readonly reporter: DeriveErrorsReporter;
  readonly schemas: Schemas;
  readonly role: DerivationRole;
  readonly code: IrWriter.ErrorCode;
  /** The params schema of the code; absent when it declares none. */
  readonly paramsSchema?: IrWriter.SchemaRef;
  /** The written template; absent for the by-name template. */
  readonly template?: DeriveErrorsRawValue;
  /** The param `conventions.rateLimit.param` names, which receives `rateLimited`'s delay. */
  readonly rateLimitParam?: string;
  /** Where problems are reported: the binding, or the declaration a default binding checks. */
  readonly pointer: string;
}

const ITEM_SLOT = "item";

/** The param a datum fills by name: `rateLimited`'s delay fills the param `conventions.rateLimit` names. */
export function deriveErrorsParamOfDatum(
  site: Pick<DeriveErrorsRoleParamsSite, "role" | "rateLimitParam">,
  datum: DerivationRoleDatum,
): string {
  if (
    site.role.role === "rateLimited" &&
    datum.required === "conditional" &&
    site.rateLimitParam !== undefined
  )
    return site.rateLimitParam;

  return datum.name;
}

/** Whether a datum has a value wherever its role answers (ADR 0006 section 6, the Data column). */
export function deriveErrorsDatumAlways(
  site: Pick<DeriveErrorsRoleParamsSite, "role" | "rateLimitParam">,
  datum: DerivationRoleDatum,
): boolean {
  if (datum.required === "always") return true;

  // The delay is supplied wherever conventions.rateLimit names its param; `forbidden`'s pointer only on a rejected
  // restricted input field, never on the other denials the role answers on the same operation.
  return (
    site.role.role === "rateLimited" &&
    datum.required === "conditional" &&
    site.rateLimitParam !== undefined
  );
}

const objectSchemaOf = (
  schemas: Schemas,
  id: IrWriter.SchemaId | undefined,
): PassReadonly<IrWriter.ObjectSchema> | undefined => {
  if (id === undefined || !Object.hasOwn(schemas, id)) return undefined;

  const schema = schemas[id];

  return schema?.kind === "object" ? schema : undefined;
};

/** The properties of a code's params schema, in its order; empty without params. */
export function deriveErrorsParamProperties(
  schemas: Schemas,
  params: IrWriter.SchemaRef | undefined,
): readonly PassReadonly<IrWriter.Property>[] {
  return objectSchemaOf(schemas, params)?.properties ?? [];
}

// A datum's slot kind sets where the reader lets it stand: `$each` takes an array, `$merge` an object.
function slotKindOf(schemas: Schemas, use: Use): TemplateSlotKind {
  if (use.kind === "array") return "array";

  if (use.kind === "ref" && objectSchemaOf(schemas, use.schema) !== undefined) return "object";

  return "value";
}

function siteOf(site: DeriveErrorsRoleParamsSite, faults: { count: number }): TemplateSite {
  const { role, schemas, reporter } = site;
  const slots: TemplateSlot[] = role.data.map((datum) => ({
    name: datum.name,
    kind: slotKindOf(schemas, datum.type),
  }));
  const eachSlots: TemplateSlot[] = role.data.flatMap((datum) =>
    datum.type.kind === "array"
      ? [{ name: ITEM_SLOT, kind: slotKindOf(schemas, datum.type.items) }]
      : [],
  );

  return {
    slots,
    eachSlots,
    owner: `the binding of role '${role.role}'`,
    placeName: `the params of role '${role.role}'`,
    exampleSlot: `$${role.data[0]?.name ?? ITEM_SLOT}`,
    adrSections: "ADR 0006 section 6",
    report: (fault) => {
      faults.count += 1;
      reporter.error({
        rule: "role-template",
        message: fault.message,
        fix: fault.fix,
        pointer: fault.pointer,
      });
    },
  };
}

// The pointer of an `each` written inside another `each`'s `as`, if any.
function nestedEachPointer(
  value: DeriveErrorsRawValue,
  pointer: string,
  inEach: boolean,
): string | undefined {
  if (Array.isArray(value))
    return value
      .map((item, index) =>
        nestedEachPointer(item, pipelinePointerBelow(pointer, String(index)), inEach),
      )
      .find((found) => found !== undefined);

  if (!pipelineIsJsonObject(value)) return undefined;

  if (Object.hasOwn(value, "$each")) {
    if (inEach) return pointer;

    const as = value.$as;

    return as === undefined
      ? undefined
      : nestedEachPointer(as, pipelinePointerBelow(pointer, "$as"), true);
  }

  return Object.entries(value)
    .map(([key, member]) => nestedEachPointer(member, pipelinePointerBelow(pointer, key), inEach))
    .find((found) => found !== undefined);
}

// The top-level keys of a written template must be params of the code: a `$` key (a merge, a map, a slot name or a
// literal dollar) names none, and a template that is no object fills none.
function checkTopLevelKeys(site: DeriveErrorsRoleParamsSite, names: ReadonlySet<string>): boolean {
  const { template, role, code, reporter } = site;
  const paramsPointer = pipelinePointerBelow(site.pointer, "params");

  if (!pipelineIsJsonObject(template) || Object.hasOwn(template, "$each")) {
    reporter.error({
      rule: "role-param",
      message: `the params template of role '${role.role}' is no object, so it fills no param of ${quote(code)}`,
      fix: "write params as an object whose keys are params of the code: { <param>: $<datum> }",
      pointer: paramsPointer,
    });

    return false;
  }

  let accepted = true;

  for (const key of Object.keys(template)) {
    if (names.has(key)) continue;

    accepted = false;
    reporter.error({
      rule: "role-param",
      message: `the params template of role '${role.role}' writes ${quote(key)}, which is no param of ${quote(code)}`,
      fix: `write only params of ${quote(code)} as keys, or add a param ${quote(key)} to it`,
      pointer: pipelinePointerBelow(paramsPointer, key),
    });
  }

  return accepted;
}

/** The by-name template: one member per param that has a datum of its name, in the params schema's order. */
function byNameTemplate(
  site: DeriveErrorsRoleParamsSite,
  properties: readonly PassReadonly<IrWriter.Property>[],
): IrWriter.Template {
  const members: IrWriter.ObjectTemplateMember[] = [];

  for (const property of properties) {
    const datum = site.role.data.find(
      (candidate) => deriveErrorsParamOfDatum(site, candidate) === property.name,
    );

    if (datum !== undefined)
      members.push({
        name: { kind: "text", text: property.name },
        value: { kind: "slot", slot: datum.name, path: [] },
      });
  }

  return { kind: "object", members };
}

/** Reads the params of a binding: the written template or the by-name one; each fault is reported at its pointer. */
export function deriveErrorsReadRoleParams(
  site: DeriveErrorsRoleParamsSite,
): DeriveErrorsRoleParams {
  const properties = deriveErrorsParamProperties(site.schemas, site.paramsSchema);
  const names = new Set(properties.map((property) => property.name));

  if (site.template !== undefined && !checkTopLevelKeys(site, names)) return { refused: true };

  if (site.paramsSchema === undefined) return { refused: false };

  const template =
    site.template === undefined
      ? byNameTemplate(site, properties)
      : readWritten(site, site.template);

  return template === undefined ? { refused: true } : { refused: false, params: template };
}

/** Checks that the params a template renders validate against the code's params schema; false when refused. */
export function deriveErrorsCheckRoleParamTypes(
  site: DeriveErrorsRoleParamsSite,
  template: IrWriter.Template,
): boolean {
  if (site.paramsSchema === undefined) return true;

  const typed: TypedCheck = { site, faults: 0 };

  checkObject(typed, template, site.paramsSchema, {
    param: "",
    // A by-name template is not written, so its problems are located at the binding.
    pointer:
      site.template === undefined ? site.pointer : pipelinePointerBelow(site.pointer, "params"),
  });

  return typed.faults === 0;
}

function readWritten(
  site: DeriveErrorsRoleParamsSite,
  raw: DeriveErrorsRawValue,
): IrWriter.Template | undefined {
  const pointer = pipelinePointerBelow(site.pointer, "params");
  const faults = { count: 0 };
  const template = templateRead(siteOf(site, faults), raw, pointer);

  if (template === undefined || faults.count > 0) return undefined;

  const nested = nestedEachPointer(raw, pointer, false);

  if (nested === undefined) return template;

  site.reporter.error({
    rule: "role-template",
    message: `the params template of role '${site.role.role}' maps with $each inside another $each, but role data are flat`,
    fix: "map the role's array datum once, writing each item's members inside $as",
    pointer: nested,
  });

  return undefined;
}

// The typed check: what a template renders and whether its param's use takes it.

/** A JSON type a rendered value may have. */
type JsonKind = "string" | "integer" | "number" | "boolean" | "null" | "array" | "object";

const ANY_KIND = "any";

type Kinds = ReadonlySet<JsonKind> | typeof ANY_KIND;

interface TypedCheck {
  readonly site: DeriveErrorsRoleParamsSite;
  faults: number;
}

/** Where a template stands: the top-level param it fills and its raw pointer. */
interface Position {
  readonly param: string;
  readonly pointer: string;
  /** The type use of the item `item` reads inside an `each`. */
  readonly item?: Use;
}

/** The value a slot renders: its type use, or none when its path leads nowhere, and whether it always has one. */
interface SlotValue {
  readonly use?: Use;
  readonly nullable: boolean;
  readonly always: boolean;
}

function kindsOfUse(schemas: Schemas, use: Use, nullable: boolean): Kinds {
  const useNullable = "nullable" in use && use.nullable === true;
  const kinds = new Set<JsonKind>(nullable || useNullable ? ["null"] : []);

  switch (use.kind) {
    case "opaque":
      return ANY_KIND;
    case "file":
      return kinds;
    case "enum":
      return kinds.add("string");
    case "array":
      return kinds.add("array");
    case "scalar":
      if (use.type === "number") kinds.add("integer");

      return kinds.add(use.type);
    case "ref": {
      const schema = Object.hasOwn(schemas, use.schema) ? schemas[use.schema] : undefined;

      return schema?.kind === "union" ? ANY_KIND : kinds.add("object");
    }
  }
}

function kindOfLiteral(value: unknown): JsonKind {
  if (value === null) return "null";

  if (Array.isArray(value)) return "array";

  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";

  if (typeof value === "boolean") return "boolean";

  return typeof value === "string" ? "string" : "object";
}

const fits = (rendered: Kinds, accepted: Kinds): boolean =>
  accepted === ANY_KIND ||
  (rendered !== ANY_KIND && [...rendered].every((kind) => accepted.has(kind)));

const describeKinds = (kinds: Kinds): string =>
  kinds === ANY_KIND ? "any JSON value" : [...kinds].sort().join(" or ");

/** A member a slot path reads. */
interface PathMember {
  readonly type: Use;
  readonly optional: boolean;
  readonly nullable: boolean;
}

// The issue schema is core data: read from the draft when tree.schemas seeded it, else from the role data it is
// seeded from (each member required, none nullable).
function memberOf(schemas: Schemas, use: Use, member: string): PathMember | undefined {
  if (use.kind !== "ref") return undefined;

  const schema = objectSchemaOf(schemas, use.schema);

  if (schema !== undefined) return schema.properties.find((property) => property.name === member);

  if (use.schema !== DERIVATION_ISSUE_SCHEMA_ID) return undefined;

  const issueMember = derivationIssueMembers.find((candidate) => candidate.name === member);

  return issueMember === undefined
    ? undefined
    : { type: issueMember.type, optional: false, nullable: false };
}

function slotValue(
  check: TypedCheck,
  position: Position,
  slot: string,
  path: readonly string[],
): SlotValue {
  const { site } = check;
  const datum = site.role.data.find((candidate) => candidate.name === slot);
  let use: Use | undefined =
    slot === ITEM_SLOT && datum === undefined ? position.item : datum?.type;
  let always = datum === undefined ? use !== undefined : deriveErrorsDatumAlways(site, datum);
  let nullable = false;

  for (const member of path) {
    const property = use === undefined ? undefined : memberOf(site.schemas, use, member);

    if (property === undefined) return { nullable: false, always: false };

    use = property.type;
    always &&= !property.optional;
    nullable = property.nullable;
  }

  return { ...(use === undefined ? {} : { use }), nullable, always };
}

function refuseType(check: TypedCheck, position: Position, what: string, accepted: Kinds): void {
  const { role, code } = check.site;

  check.faults += 1;
  check.site.reporter.error({
    rule: "role-param-type",
    message: `role '${role.role}' fills the param ${quote(position.param)} of ${quote(code)} with ${what}, which its type (${describeKinds(accepted)}) does not take`,
    fix: `fill ${quote(position.param)} with a value of its type, or change the param's type in ${quote(code)}`,
    pointer: position.pointer,
  });
}

function refuseMember(check: TypedCheck, position: Position, member: string): void {
  const { role, code } = check.site;

  check.faults += 1;
  check.site.reporter.error({
    rule: "role-param-type",
    message: `role '${role.role}' writes the member ${quote(member)} into the param ${quote(position.param)} of ${quote(code)}, whose type has no such member`,
    fix: `write only members of the param's type, or add ${quote(member)} to it`,
    pointer: position.pointer,
  });
}

function refuseMissing(check: TypedCheck, position: Position, member: string): void {
  const { role, code } = check.site;
  const where = member === position.param ? "" : ` (its member ${quote(member)})`;

  check.faults += 1;
  check.site.reporter.error({
    rule: "role-param-required",
    message: `role '${role.role}' may leave the required param ${quote(position.param)} of ${quote(code)}${where} without a value`,
    fix: `fill it with a literal or a datum role '${role.role}' always supplies, or make it optional in ${quote(code)}`,
    pointer: position.pointer,
  });
}

/** Whether a template always renders a value (docs/ir/07: a slot without a value has none, and so on up). */
function alwaysValued(check: TypedCheck, position: Position, template: Template): boolean {
  switch (template.kind) {
    case "literal":
    case "array":
      return true;
    case "slot":
      return slotValue(check, position, template.slot, template.path).always;
    case "text":
      return template.parts.every(
        (part) => part.kind === "text" || slotValue(check, position, part.slot, part.path).always,
      );
    case "each":
      return slotValue(check, position, template.of, []).always;
    case "object":
      return template.members.some((member) => alwaysValued(check, position, member.value));
  }
}

function checkValue(check: TypedCheck, template: Template, use: Use, position: Position): void {
  const { schemas } = check.site;
  const accepted = kindsOfUse(schemas, use, false);

  switch (template.kind) {
    case "literal": {
      const kind = kindOfLiteral(template.value);

      if (!fits(new Set([kind]), accepted))
        refuseType(check, position, `a literal ${kind}`, accepted);

      return;
    }

    case "slot": {
      const value = slotValue(check, position, template.slot, template.path);
      const rendered =
        value.use === undefined
          ? new Set<JsonKind>()
          : kindsOfUse(schemas, value.use, value.nullable);

      if (!fits(rendered, accepted))
        refuseType(
          check,
          position,
          `$${[template.slot, ...template.path].join(".")}, ${describeKinds(rendered)}`,
          accepted,
        );

      return;
    }

    case "text":
      checkText(check, template, accepted, position);

      return;
    case "object":
      if (!fits(new Set(["object"]), accepted)) {
        refuseType(check, position, "an object", accepted);

        return;
      }

      if (use.kind === "ref") checkObject(check, template, use.schema, position);

      return;
    case "array":
    case "each":
      if (!fits(new Set(["array"]), accepted)) {
        refuseType(check, position, "an array", accepted);

        return;
      }

      if (use.kind === "array") checkItems(check, template, use.items, position);
  }
}

// A text renders a string; a number or boolean part is its JSON text, an object or array part has no text form.
function checkText(
  check: TypedCheck,
  template: PassReadonly<IrWriter.TextTemplate>,
  accepted: Kinds,
  position: Position,
): void {
  if (!fits(new Set(["string"]), accepted)) {
    refuseType(check, position, "a text", accepted);

    return;
  }

  for (const part of template.parts) {
    if (part.kind === "text") continue;

    const value = slotValue(check, position, part.slot, part.path);
    const rendered =
      value.use === undefined
        ? new Set<JsonKind>()
        : kindsOfUse(check.site.schemas, value.use, false);

    if (rendered === ANY_KIND || rendered.has("object") || rendered.has("array"))
      refuseType(check, position, `a text holding $${part.slot}, which has no text form`, accepted);
  }
}

function checkItems(
  check: TypedCheck,
  template: PassReadonly<IrWriter.ArrayTemplate> | PassReadonly<IrWriter.EachTemplate>,
  items: Use,
  position: Position,
): void {
  if (template.kind === "array") {
    for (const [index, item] of template.items.entries())
      checkValue(check, item, items, {
        ...position,
        pointer: pipelinePointerBelow(position.pointer, String(index)),
      });

    return;
  }

  const mapped = slotValue(check, position, template.of, []).use;
  const item = mapped?.kind === "array" ? mapped.items : undefined;

  checkValue(check, template.as, items, {
    param: position.param,
    pointer: pipelinePointerBelow(position.pointer, "$as"),
    ...(item === undefined ? {} : { item }),
  });
}

// The raw key of a member: a member name starting with `$` is written `$$`.
const rawKeyOf = (name: string): string => (name.startsWith("$") ? `$${name}` : name);

function checkObject(
  check: TypedCheck,
  template: Template,
  schemaId: IrWriter.SchemaId,
  position: Position,
): void {
  const schema = objectSchemaOf(check.site.schemas, schemaId);

  if (schema === undefined || template.kind !== "object") return;

  const top = position.param === "";
  const filled = new Set<string>();
  const written = new Map<string, Position>();

  for (const member of template.members) {
    if (member.name.kind !== "text") continue;

    const name = member.name.text;
    const property = schema.properties.find((candidate) => candidate.name === name);
    const memberPosition: Position = {
      ...position,
      param: top ? name : position.param,
      pointer:
        check.site.template === undefined
          ? position.pointer
          : pipelinePointerBelow(position.pointer, rawKeyOf(name)),
    };

    if (property === undefined) {
      refuseMember(check, memberPosition, name);
      continue;
    }

    written.set(name, memberPosition);

    if (alwaysValued(check, memberPosition, member.value)) filled.add(name);

    checkValue(check, member.value, property.type, memberPosition);
  }

  for (const name of mergedRequired(check, position, template)) filled.add(name);

  // A member written without a sure value is located where it is written, a missing one at its object.
  for (const property of schema.properties)
    if (!property.optional && !filled.has(property.name))
      refuseMissing(
        check,
        written.get(property.name) ?? (top ? { ...position, param: property.name } : position),
        property.name,
      );
}

// `$merge` of an object slot fills the required members of its schema (an item of the issues list, say).
function mergedRequired(
  check: TypedCheck,
  position: Position,
  template: PassReadonly<IrWriter.ObjectTemplate>,
): string[] {
  if (template.merge === undefined) return [];

  const value = slotValue(check, position, template.merge, []);
  const merged =
    value.use?.kind === "ref" && value.always
      ? objectSchemaOf(check.site.schemas, value.use.schema)
      : undefined;

  return (merged?.properties ?? [])
    .filter((property) => !property.optional)
    .map((property) => property.name);
}
