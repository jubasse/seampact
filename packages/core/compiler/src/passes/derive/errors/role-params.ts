import type { IrWriter } from "@seampact/spec/ir";
import type { DerivationRole, DerivationRoleDatum } from "../../../derivations/index.js";
import {
  type PassReadonly,
  pipelineIsJsonObject,
  pipelinePointerBelow,
  type TreeSchemaService,
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
import { type DeriveErrorsSchemas, deriveErrorsObjectOfUse } from "./role-param-fit.js";

// The params of a role binding (ADR 0002 section 11 "Error roles", docs/ir/07): an authored `params` template read by
// the shared template reader with the role's data as its slots, or the by-name template when none is written. The
// rendered params must validate against the code's params schema whatever the data, which `role-param-types.ts`
// checks. Role data are flat, so an `each` inside another `each`'s `as` is refused.

type Schemas = DeriveErrorsSchemas;

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
  /** The example validator of tree.schemas, which checks a literal against its param's use. */
  readonly examples: Pick<TreeSchemaService, "checkExample">;
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

/** The slot an `each`'s `as` reads its item from. */
export const DERIVE_ERRORS_ITEM_SLOT = "item";

const RATE_LIMITED_ROLE = "rateLimited";

type DatumSite = Pick<DeriveErrorsRoleParamsSite, "role" | "rateLimitParam">;

// `rateLimited`'s conditional datum, the delay, fills the param `conventions.rateLimit` names wherever it names one.
const fillsRateLimitParam = (site: DatumSite, datum: DerivationRoleDatum): boolean =>
  site.role.role === RATE_LIMITED_ROLE &&
  datum.required === "conditional" &&
  site.rateLimitParam !== undefined;

/** The param a datum fills by name: `rateLimited`'s delay fills the param `conventions.rateLimit` names. */
export function deriveErrorsParamOfDatum(site: DatumSite, datum: DerivationRoleDatum): string {
  const rateLimitParam = site.rateLimitParam;

  return rateLimitParam !== undefined && fillsRateLimitParam(site, datum)
    ? rateLimitParam
    : datum.name;
}

/** Whether a datum has a value wherever its role answers (ADR 0006 section 6, the Data column). */
export function deriveErrorsDatumAlways(site: DatumSite, datum: DerivationRoleDatum): boolean {
  if (datum.required === "always") return true;

  // `forbidden`'s pointer is supplied only on a rejected restricted input field, never on the other denials the role
  // answers on the same operation.
  return fillsRateLimitParam(site, datum);
}

/** The properties of a code's params schema, in its order; empty without params. */
export function deriveErrorsParamProperties(
  schemas: Schemas,
  params: IrWriter.SchemaRef | undefined,
): readonly PassReadonly<IrWriter.Property>[] {
  if (params === undefined) return [];

  // tree.schemas compiles params to an object schema or refuses them (`fields-schema`), and no later half runs then.
  return deriveErrorsObjectOfUse(schemas, { kind: "ref", schema: params })?.properties ?? [];
}

// A datum's slot kind sets where the reader lets it stand: `$each` takes an array, `$merge` an object.
function slotKindOf(schemas: Schemas, use: Use): TemplateSlotKind {
  if (use.kind === "array") return "array";

  if (deriveErrorsObjectOfUse(schemas, use) !== undefined) return "object";

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
      ? [{ name: DERIVE_ERRORS_ITEM_SLOT, kind: slotKindOf(schemas, datum.type.items) }]
      : [],
  );

  return {
    slots,
    eachSlots,
    owner: `the binding of role '${role.role}'`,
    placeName: `the params of role '${role.role}'`,
    exampleSlot: `$${role.data[0]?.name ?? DERIVE_ERRORS_ITEM_SLOT}`,
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

/** The raw key of a member: a member name starting with `$` is written `$$`. */
export const deriveErrorsRawKeyOf = (name: string): string =>
  name.startsWith("$") ? `$${name}` : name;

const rawKeyOfMember = (name: IrWriter.MemberName): string =>
  name.kind === "text" ? deriveErrorsRawKeyOf(name.text) : `$${name.slot}`;

// The raw pointer of an `each` written inside another `each`'s `as`, if any.
function nestedEachPointer(
  template: Template,
  pointer: string,
  inEach: boolean,
): string | undefined {
  switch (template.kind) {
    case "each":
      return inEach
        ? pointer
        : nestedEachPointer(template.as, pipelinePointerBelow(pointer, "$as"), true);
    case "array":
      return template.items
        .map((item, index) =>
          nestedEachPointer(item, pipelinePointerBelow(pointer, String(index)), inEach),
        )
        .find((found) => found !== undefined);
    case "object":
      return template.members
        .map((member) =>
          nestedEachPointer(
            member.value,
            pipelinePointerBelow(pointer, rawKeyOfMember(member.name)),
            inEach,
          ),
        )
        .find((found) => found !== undefined);
    default:
      return undefined;
  }
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

function readWritten(
  site: DeriveErrorsRoleParamsSite,
  raw: DeriveErrorsRawValue,
): IrWriter.Template | undefined {
  const pointer = pipelinePointerBelow(site.pointer, "params");
  const faults = { count: 0 };
  const template = templateRead(siteOf(site, faults), raw, pointer);

  if (template === undefined || faults.count > 0) return undefined;

  const nested = nestedEachPointer(template, pointer, false);

  if (nested === undefined) return template;

  site.reporter.error({
    rule: "role-template",
    message: `the params template of role '${site.role.role}' maps with $each inside another $each, but role data are flat`,
    fix: "map the role's array datum once, writing each item's members inside $as",
    pointer: nested,
  });

  return undefined;
}
