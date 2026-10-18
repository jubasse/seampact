import type { IrWriter } from "@seampact/spec/ir";
import { type PassReadonly, pipelineCopy, pipelinePointerBelow } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import {
  DERIVE_ERRORS_ANY_KIND,
  type DeriveErrorsFit,
  type DeriveErrorsTyped,
  type DeriveErrorsUse,
  deriveErrorsDescribeKinds,
  deriveErrorsKindsFit,
  deriveErrorsKindsOf,
  deriveErrorsMemberMisfits,
  deriveErrorsMisfit,
  deriveErrorsObjectOfUse,
} from "./role-param-fit.js";
import {
  DERIVE_ERRORS_ITEM_SLOT,
  type DeriveErrorsRoleParamsSite,
  deriveErrorsDatumAlways,
  deriveErrorsRawKeyOf,
} from "./role-params.js";

// The typed check of a role binding's params: every param the template fills gets a value its type use takes,
// whatever the role's data hold, and a required param gets one whenever the binding answers.

type Use = DeriveErrorsUse;

type Template = PassReadonly<IrWriter.Template>;

interface TypedCheck {
  readonly site: DeriveErrorsRoleParamsSite;
  readonly fit: DeriveErrorsFit;
  faults: number;
}

/** Where a template stands: the top-level param it fills and its raw pointer. */
interface Position {
  readonly param: string;
  readonly pointer: string;
  /** The type use of the item `item` reads inside an `each`. */
  readonly item?: Use;
}

/** The value a slot renders and whether it always has one; or the member its path names that does not exist. */
type SlotValue =
  | { readonly found: true; readonly typed: DeriveErrorsTyped; readonly always: boolean }
  | { readonly found: false; readonly datum: string; readonly member: string };

const STRING_USE: IrWriter.ScalarTypeUse = { kind: "scalar", type: "string", refinements: {} };

/** Checks that the params a template renders validate against the code's params schema; false when refused. */
export function deriveErrorsCheckRoleParamTypes(
  site: DeriveErrorsRoleParamsSite,
  template: IrWriter.Template,
): boolean {
  if (site.paramsSchema === undefined) return true;

  const schema = deriveErrorsObjectOfUse(site.schemas, { kind: "ref", schema: site.paramsSchema });

  if (schema === undefined)
    throw new Error(`the params schema ${site.paramsSchema} of '${site.code}' is no object schema`);

  const typed: TypedCheck = {
    site,
    fit: { schemas: site.schemas, examples: site.examples },
    faults: 0,
  };

  checkObject(typed, template, schema, {
    param: "",
    // A by-name template is not written, so its problems are located at the binding.
    pointer:
      site.template === undefined ? site.pointer : pipelinePointerBelow(site.pointer, "params"),
  });

  return typed.faults === 0;
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
    slot === DERIVE_ERRORS_ITEM_SLOT && datum === undefined ? position.item : datum?.type;

  // The reader lets a template read only the role's data, and `item` only inside the `as` of an array datum.
  if (use === undefined) throw new Error(`the slot $${slot} at ${position.pointer} reads no datum`);

  let always = datum === undefined || deriveErrorsDatumAlways(site, datum);
  let nullable = false;
  let read = slot;

  for (const member of path) {
    const property: PassReadonly<IrWriter.Property> | undefined = deriveErrorsObjectOfUse(
      site.schemas,
      use,
    )?.properties.find((candidate) => candidate.name === member);

    if (property === undefined) return { found: false, datum: read, member };

    use = property.type;
    always &&= !property.optional;
    nullable = property.nullable;
    read = `${read}.${member}`;
  }

  return { found: true, typed: { use, nullable }, always };
}

function refuse(check: TypedCheck, position: Position, message: string, fix: string): void {
  check.faults += 1;
  check.site.reporter.error({ rule: "role-param-type", message, fix, pointer: position.pointer });
}

function refuseType(check: TypedCheck, position: Position, what: string, reason: string): void {
  const { role, code } = check.site;

  refuse(
    check,
    position,
    `role '${role.role}' fills the param ${quote(position.param)} of ${quote(code)} with ${what}, but ${reason}`,
    `fill ${quote(position.param)} with a value its type provably takes, or change the param's type in ${quote(code)}`,
  );
}

function refuseMember(check: TypedCheck, position: Position, member: string): void {
  const { role, code } = check.site;

  refuse(
    check,
    position,
    `role '${role.role}' writes the member ${quote(member)} into the param ${quote(position.param)} of ${quote(code)}, whose type has no such member`,
    `write only members of the param's type, or add ${quote(member)} to it`,
  );
}

function refuseUnknownPath(
  check: TypedCheck,
  position: Position,
  value: Extract<SlotValue, { found: false }>,
): void {
  const { role } = check.site;

  refuse(
    check,
    position,
    `role '${role.role}' reads $${value.datum}.${value.member}, but $${value.datum} has no member ${quote(value.member)}`,
    `read a member $${value.datum} has, or the datum itself`,
  );
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
  const slotAlways = (slot: string, path: readonly string[]): boolean => {
    const value = slotValue(check, position, slot, path);

    return value.found && value.always;
  };

  switch (template.kind) {
    case "literal":
    case "array":
      return true;
    case "slot":
      return slotAlways(template.slot, template.path);
    case "text":
      return template.parts.every(
        (part) => part.kind === "text" || slotAlways(part.slot, part.path),
      );
    case "each":
      return slotAlways(template.of, []);
    case "object":
      return template.members.some((member) => alwaysValued(check, position, member.value));
  }
}

function checkValue(
  check: TypedCheck,
  template: Template,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  switch (template.kind) {
    case "literal":
      checkLiteral(check, template.value, accepted, position);

      return;
    case "slot":
      checkSlot(check, template, accepted, position);

      return;
    case "text":
      checkText(check, template, accepted, position);

      return;
    case "object":
      checkObjectValue(check, template, accepted, position);

      return;
    case "array":
    case "each":
      checkArrayValue(check, template, accepted, position);
  }
}

// A literal goes through the example validator of tree.schemas, each issue located inside the literal.
function checkLiteral(
  check: TypedCheck,
  value: unknown,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  if (value === null && accepted.nullable) return;

  for (const issue of check.fit.examples.checkExample(value, pipelineCopy(accepted.use)))
    refuseType(
      check,
      { ...position, pointer: `${position.pointer}${issue.pointer}` },
      `the literal ${JSON.stringify(value)}`,
      `it does not fit its type: ${issue.message}`,
    );
}

function checkSlot(
  check: TypedCheck,
  template: PassReadonly<IrWriter.SlotTemplate>,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  const value = slotValue(check, position, template.slot, template.path);

  if (!value.found) {
    refuseUnknownPath(check, position, value);

    return;
  }

  const reason = deriveErrorsMisfit(check.fit, value.typed, accepted);

  if (reason !== undefined)
    refuseType(check, position, `$${[template.slot, ...template.path].join(".")}`, reason);
}

// A text renders a string; a number or boolean part is its JSON text, an object or array part has no text form.
function checkText(
  check: TypedCheck,
  template: PassReadonly<IrWriter.TextTemplate>,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  const reason = deriveErrorsMisfit(check.fit, { use: STRING_USE, nullable: false }, accepted);

  if (reason !== undefined) {
    refuseType(check, position, "a text", reason);

    return;
  }

  for (const part of template.parts) {
    if (part.kind === "text") continue;

    const value = slotValue(check, position, part.slot, part.path);

    if (!value.found) {
      refuseUnknownPath(check, position, value);
      continue;
    }

    const rendered = deriveErrorsKindsOf(check.site.schemas, { ...value.typed, nullable: false });

    if (rendered === DERIVE_ERRORS_ANY_KIND || rendered.has("object") || rendered.has("array"))
      refuseType(check, position, `a text holding $${part.slot}`, "it has no text form");
  }
}

function checkObjectValue(
  check: TypedCheck,
  template: PassReadonly<IrWriter.ObjectTemplate>,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  if (accepted.use.kind === "opaque") return;

  const schema = deriveErrorsObjectOfUse(check.site.schemas, accepted.use);

  if (schema === undefined) {
    refuseType(
      check,
      position,
      "an object",
      `the param's type (${deriveErrorsDescribeKinds(deriveErrorsKindsOf(check.site.schemas, accepted))}) is no object schema to check its members against`,
    );

    return;
  }

  checkObject(check, template, schema, position);
}

// The number of items an array template writes, or an `each` maps from its array datum.
function itemCounts(
  check: TypedCheck,
  template: PassReadonly<IrWriter.ArrayTemplate> | PassReadonly<IrWriter.EachTemplate>,
  position: Position,
): { readonly min?: number; readonly max?: number } {
  if (template.kind === "array") return { min: template.items.length, max: template.items.length };

  const mapped = slotValue(check, position, template.of, []);
  const use = mapped.found ? mapped.typed.use : undefined;

  return use?.kind === "array"
    ? {
        ...(use.minItems === undefined ? {} : { min: use.minItems }),
        ...(use.maxItems === undefined ? {} : { max: use.maxItems }),
      }
    : {};
}

function checkArrayValue(
  check: TypedCheck,
  template: PassReadonly<IrWriter.ArrayTemplate> | PassReadonly<IrWriter.EachTemplate>,
  accepted: DeriveErrorsTyped,
  position: Position,
): void {
  const kinds = deriveErrorsKindsOf(check.site.schemas, accepted);
  const what = template.kind === "array" ? "an array" : `$each over $${template.of}`;

  if (!deriveErrorsKindsFit(new Set(["array"]), kinds)) {
    refuseType(
      check,
      position,
      what,
      `the param's type (${deriveErrorsDescribeKinds(kinds)}) does not take an array`,
    );

    return;
  }

  const { use } = accepted;

  if (use.kind !== "array") return;

  const counts = itemCounts(check, template, position);

  if (use.minItems !== undefined && (counts.min === undefined || counts.min < use.minItems))
    refuseType(
      check,
      position,
      what,
      `it may hold fewer items than the param's minItems ${use.minItems}`,
    );

  if (use.maxItems !== undefined && (counts.max === undefined || counts.max > use.maxItems))
    refuseType(
      check,
      position,
      what,
      `it may hold more items than the param's maxItems ${use.maxItems}`,
    );

  checkItems(check, template, use.items, position);
}

function checkItems(
  check: TypedCheck,
  template: PassReadonly<IrWriter.ArrayTemplate> | PassReadonly<IrWriter.EachTemplate>,
  items: Use,
  position: Position,
): void {
  const accepted: DeriveErrorsTyped = { use: items, nullable: false };

  if (template.kind === "array") {
    for (const [index, item] of template.items.entries())
      checkValue(check, item, accepted, {
        ...position,
        pointer: pipelinePointerBelow(position.pointer, String(index)),
      });

    return;
  }

  const mapped = slotValue(check, position, template.of, []);
  const item =
    mapped.found && mapped.typed.use.kind === "array" ? mapped.typed.use.items : undefined;

  checkValue(check, template.as, accepted, {
    param: position.param,
    pointer: pipelinePointerBelow(position.pointer, "$as"),
    ...(item === undefined ? {} : { item }),
  });
}

function checkObject(
  check: TypedCheck,
  template: Template,
  schema: PassReadonly<IrWriter.ObjectSchema>,
  position: Position,
): void {
  if (template.kind !== "object") return;

  const top = position.param === "";
  const filled = new Set<string>();
  const written = new Map<string, Position>();

  for (const member of template.members) {
    // Only `$collection` names a member by slot, and no role supplies it.
    if (member.name.kind !== "text")
      throw new Error(`the role params at ${position.pointer} name a member by slot`);

    const name = member.name.text;
    const property = schema.properties.find((candidate) => candidate.name === name);
    const memberPosition: Position = {
      ...position,
      param: top ? name : position.param,
      pointer:
        check.site.template === undefined
          ? position.pointer
          : pipelinePointerBelow(position.pointer, deriveErrorsRawKeyOf(name)),
    };

    if (property === undefined) {
      refuseMember(check, memberPosition, name);
      continue;
    }

    written.set(name, memberPosition);

    const faultsBefore = check.faults;

    checkValue(
      check,
      member.value,
      { use: property.type, nullable: property.nullable },
      memberPosition,
    );

    // A member refused for its value is not reported again as maybe missing.
    if (check.faults > faultsBefore || alwaysValued(check, memberPosition, member.value))
      filled.add(name);
  }

  for (const name of checkMerged(check, position, template, schema)) filled.add(name);

  // A member written without a sure value is located where it is written, a missing one at its object.
  for (const property of schema.properties)
    if (!property.optional && !filled.has(property.name))
      refuseMissing(
        check,
        written.get(property.name) ?? (top ? { ...position, param: property.name } : position),
        property.name,
      );
}

// `$merge` of an object slot writes each member of its schema beside the written ones: each is checked as if written
// (located at the merge), and the required ones of a slot the role always supplies are filled.
function checkMerged(
  check: TypedCheck,
  position: Position,
  template: PassReadonly<IrWriter.ObjectTemplate>,
  schema: PassReadonly<IrWriter.ObjectSchema>,
): string[] {
  if (template.merge === undefined) return [];

  const value = slotValue(check, position, template.merge, []);
  const merged = value.found
    ? deriveErrorsObjectOfUse(check.site.schemas, value.typed.use)
    : undefined;

  // The reader lets `$merge` take an object slot only.
  if (!value.found || merged === undefined)
    throw new Error(`the $merge at ${position.pointer} reads no object datum`);

  const mergePosition: Position = {
    ...position,
    pointer:
      check.site.template === undefined
        ? position.pointer
        : pipelinePointerBelow(position.pointer, "$merge"),
  };
  const writtenNames = new Set(
    template.members.flatMap((member) => (member.name.kind === "text" ? [member.name.text] : [])),
  );

  const misfits = deriveErrorsMemberMisfits(check.fit, merged, schema, writtenNames);

  for (const misfit of misfits) {
    const memberPosition = {
      ...mergePosition,
      param: position.param === "" ? misfit.member : position.param,
    };

    if (misfit.lacking) refuseMember(check, memberPosition, misfit.member);
    else refuseType(check, memberPosition, `$${template.merge}.${misfit.member}`, misfit.reason);
  }

  // A member refused here is not reported again as maybe missing.
  const reported = misfits.map((misfit) => misfit.member);

  if (!value.always) return reported;

  return [
    ...reported,
    ...merged.properties.filter((property) => !property.optional).map((property) => property.name),
  ];
}
