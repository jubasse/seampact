// How a pack that rebinds the `schemaInvalid` role changes what the default cases expect: the bound code and its
// status, and the issues written under the member the binding's params template names them with.
import type { ContractIR } from "@seampact/spec/ir";
import type { JsonValue, StepExpectation } from "./suite-case.js";

const REFERENCE_CODE = "api.schema_invalid";
const REFERENCE_STATUS = 400;
const ERRORS_DERIVED_CONVENTION = "errors.derived";
const SCHEMA_INVALID_ROLE = "schemaInvalid";
const ISSUES_SLOT = "$issues";
const ITEM_SLOT_PREFIX = "$item.";

type JsonObject = { readonly [member: string]: JsonValue };

/** The IR's convention values are JSON, typed unknown. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface IssuesMember {
  readonly name: string;
  /** The issue field each key of an item reads: `{ propertyPath: "pointer", message: "rule" }`. */
  readonly itemFields: Readonly<Record<string, string>>;
}

export interface SchemaInvalidBinding {
  readonly code: string;
  readonly status: number;
  readonly issues: IssuesMember | undefined;
}

/** The pack's rebinding of `schemaInvalid`, or undefined while the role still answers the reference's code. */
export function schemaInvalidBindingOf(ir: ContractIR): SchemaInvalidBinding | undefined {
  const bindings = ir.conventions[ERRORS_DERIVED_CONVENTION]?.value;
  const binding = isObject(bindings) ? bindings[SCHEMA_INVALID_ROLE] : undefined;

  if (!isObject(binding) || typeof binding.code !== "string") return undefined;

  if (binding.code === REFERENCE_CODE) return undefined;

  const status = ir.errors[binding.code]?.http?.status;

  if (status === undefined) return undefined;

  return { code: binding.code, status, issues: issuesMemberOf(binding.params) };
}

function issuesMemberOf(params: JsonValue | undefined): IssuesMember | undefined {
  if (!isObject(params)) return undefined;

  for (const [name, template] of Object.entries(params)) {
    if (!isObject(template) || template.$each !== ISSUES_SLOT) continue;

    const itemTemplate = template.$as;

    if (!isObject(itemTemplate)) return undefined;

    return { name, itemFields: itemFieldsOf(itemTemplate) };
  }

  return undefined;
}

function itemFieldsOf(itemTemplate: JsonObject): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, source] of Object.entries(itemTemplate)) {
    if (typeof source === "string" && source.startsWith(ITEM_SLOT_PREFIX)) {
      fields[key] = source.slice(ITEM_SLOT_PREFIX.length);
    }
  }

  return fields;
}

/** An expectation of the reference's schema issue answer, written as the binding answers it; others stay as they are. */
export function withSchemaInvalidBinding(
  expectation: StepExpectation,
  binding: SchemaInvalidBinding | undefined,
): StepExpectation {
  const body = expectation.body;

  if (
    binding === undefined ||
    expectation.status !== REFERENCE_STATUS ||
    !isObject(body) ||
    body.code !== REFERENCE_CODE
  ) {
    return expectation;
  }

  const { issues, ...rest } = body;
  const rewritten =
    binding.issues === undefined ? rest : { ...rest, ...issuesAs(issues, binding.issues) };

  return { ...expectation, status: binding.status, body: { ...rewritten, code: binding.code } };
}

function issuesAs(issues: JsonValue | undefined, member: IssuesMember): Record<string, JsonValue> {
  if (!Array.isArray(issues)) return {};

  const items = issues.map((issue) => {
    if (!isObject(issue)) return issue;

    const item: Record<string, JsonValue> = {};

    for (const [key, field] of Object.entries(member.itemFields)) {
      const value = issue[field];

      if (value !== undefined) item[key] = value;
    }

    return item;
  });

  return { [member.name]: items };
}
