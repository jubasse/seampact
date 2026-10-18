import type { IrWriter } from "@seampact/spec/ir";
import {
  type DerivationRole,
  type DerivationRoleDatum,
  type DerivationRoleName,
  derivationRoles,
} from "../../../derivations/index.js";
import {
  type PassReadonly,
  pipelineIsJsonObject,
  pipelinePointerBelow,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { templateUses } from "../../../templates/index.js";
import { quote } from "../../../validate/diagnostics.js";
import { type DeriveErrorsRawValue, deriveErrorsMember, deriveErrorsString } from "./read.js";
import type { DeriveErrorsContext, DeriveErrorsRegistry } from "./registry.js";
import type { DeriveErrorsReporter } from "./report.js";
import { deriveErrorsCheckRoleParamTypes } from "./role-param-types.js";
import {
  type DeriveErrorsRoleParams,
  type DeriveErrorsRoleParamsSite,
  deriveErrorsDatumAlways,
  deriveErrorsParamOfDatum,
  deriveErrorsReadRoleParams,
} from "./role-params.js";

// Role bindings (ADR 0002 section 11 "Error roles", ADR 0006 section 6, A35): per operation, the nearest
// `errorRoles` binding wins, then `conventions.errors.derived` (packs included), then the role's default code. A
// binding is a code or `{ code, params }`, `params` a template over the role's data. Every written binding, and a
// default binding to a default code a layer redeclares, must name a registered code whose params receive each datum
// the role marks required, by name or through a template key that is a param of the code.

/** The code a role answers with where a binding applies. */
export interface DeriveErrorsBinding {
  readonly role: DerivationRoleName;
  readonly code: IrWriter.ErrorCode;
  /** The `params` template; absent when each param of the code takes the datum of its name. */
  readonly params?: DeriveErrorsRawValue;
  /** The binding's pointer in the merged raw tree; absent for the role's default code. */
  readonly pointer?: string;
}

const DERIVED_POINTER = "/conventions/errors/derived";

// A role named in the raw tree: the authoring schema admits role names only, and the validate stage runs first.
function roleOf(name: string): DerivationRole {
  const role = derivationRoles.find((candidate) => candidate.role === name);

  if (role === undefined) throw new Error(`the role data has no role ${name}`);

  return role;
}

function writtenBinding(
  role: DerivationRoleName,
  value: DeriveErrorsRawValue,
  pointer: string,
): DeriveErrorsBinding {
  if (typeof value === "string") return { role, code: value, pointer };

  const code = deriveErrorsString(value, "code");
  const params = deriveErrorsMember(value, "params");

  if (code === undefined) throw new Error(`the role binding at ${pointer} names no code`);

  return { role, code, ...(params === undefined ? {} : { params }), pointer };
}

/** The api-wide binding of a role: `conventions.errors.derived`, else the role's default code. */
export function deriveErrorsApiBinding(
  context: DeriveErrorsContext,
  role: DerivationRoleName,
): DeriveErrorsBinding {
  const reading = context.conventions.get(`errors.derived.${role}`);

  if (reading?.origin === undefined) return { role, code: roleOf(role).defaultCode };

  return writtenBinding(role, reading.value, pipelinePointerBelow(DERIVED_POINTER, role));
}

/** The binding of a role at a tree node: the nearest `errorRoles` entry, else the api-wide binding. */
export function deriveErrorsBindingAt(
  context: DeriveErrorsContext,
  node: TreeNode,
  role: DerivationRoleName,
): DeriveErrorsBinding {
  const entry = context.inherited(node, "errorRoles")?.entries.get(role);

  if (entry === undefined) return deriveErrorsApiBinding(context, role);

  return writtenBinding(
    role,
    entry.value,
    pipelinePointerBelow(entry.node.pointer, "errorRoles", role),
  );
}

/** What the binding checks read and report through. */
export interface DeriveErrorsBindingCheck {
  readonly context: DeriveErrorsContext;
  readonly reporter: DeriveErrorsReporter;
  readonly registry: DeriveErrorsRegistry;
  readonly schemas: PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;
}

/** The param `conventions.rateLimit` names for `rateLimited`'s delay, if any. */
export function deriveErrorsRateLimitParam(context: DeriveErrorsContext): string | undefined {
  const param = context.conventions.get("rateLimit.param")?.value;

  return typeof param === "string" ? param : undefined;
}

/** The params site of a binding to a registered code, its problems located at `pointer`. */
export function deriveErrorsParamsSite(
  check: DeriveErrorsBindingCheck,
  binding: DeriveErrorsBinding,
  pointer: string,
): DeriveErrorsRoleParamsSite | undefined {
  const registered = check.registry.get(binding.code);

  if (registered === undefined) return undefined;

  const { params } = registered.declaration;
  const rateLimitParam = deriveErrorsRateLimitParam(check.context);

  return {
    reporter: check.reporter,
    schemas: check.schemas,
    examples: check.context.treeSchemas,
    role: roleOf(binding.role),
    code: binding.code,
    pointer,
    ...(params === undefined ? {} : { paramsSchema: params }),
    ...(binding.params === undefined ? {} : { template: binding.params }),
    ...(rateLimitParam === undefined ? {} : { rateLimitParam }),
  };
}

// A required datum reaches the param it fills when a member of the params template reads it: the member of its
// param, or, for a datum filling the param of its own name, any member.
function datumReached(
  site: DeriveErrorsRoleParamsSite,
  params: IrWriter.Template | undefined,
  datum: DerivationRoleDatum,
): boolean {
  if (params?.kind !== "object") return false;

  const param = deriveErrorsParamOfDatum(site, datum);

  return params.members.some(
    (member) =>
      member.name.kind === "text" &&
      templateUses(member.value, datum.name) &&
      (datum.name === param || member.name.text === param),
  );
}

/**
 * Whether a datum the role supplies only on some operations reaches a param of the bound code where it is required
 * (`forbidden`'s pointer on an operation with a rejected restricted input field); reported at `pointer` otherwise.
 */
export function deriveErrorsCheckConditionalDatum(
  check: DeriveErrorsBindingCheck,
  site: DeriveErrorsRoleParamsSite,
  params: IrWriter.Template | undefined,
  datum: DerivationRoleDatum,
  operation: { readonly id: string; readonly pointer: string },
): boolean {
  if (datumReached(site, params, datum)) return true;

  const param = deriveErrorsParamOfDatum(site, datum);

  check.reporter.error({
    rule: "role-datum",
    message: `role '${site.role.role}' requires the datum '${datum.name}' on operation '${operation.id}', which has a rejected restricted input field, but no param of ${quote(site.code)} receives it`,
    fix: `add a param '${param}' to ${quote(site.code)}, or bind it with params: { ${param}: $${datum.name} }`,
    pointer: site.pointer,
    related: [
      { pointer: operation.pointer, message: `operation '${operation.id}' is declared here` },
    ],
  });

  return false;
}

/** Whether every datum a binding must carry reaches a param; each missing datum reported. */
function checkRequiredData(
  check: DeriveErrorsBindingCheck,
  site: DeriveErrorsRoleParamsSite,
  params: IrWriter.Template | undefined,
): boolean {
  let carried = true;

  for (const datum of site.role.data) {
    if (!deriveErrorsDatumAlways(site, datum) || datumReached(site, params, datum)) continue;

    const param = deriveErrorsParamOfDatum(site, datum);

    carried = false;
    check.reporter.error({
      rule: "role-datum",
      message: `role '${site.role.role}' requires the datum '${datum.name}', which no param of ${quote(site.code)} receives`,
      fix: `add a param '${param}' to ${quote(site.code)}, or bind it with params: { ${param}: $${datum.name} }`,
      pointer: site.pointer,
    });
  }

  return carried;
}

// A checked binding's params: the template the operations write, or refused (each fault reported); undefined
// when the bound code is unregistered (`role-code` reported).
function checkBinding(
  check: DeriveErrorsBindingCheck,
  binding: DeriveErrorsBinding,
  pointer: string,
): DeriveErrorsRoleParams | undefined {
  const site = deriveErrorsParamsSite(check, binding, pointer);

  if (site === undefined) {
    check.reporter.error({
      rule: "role-code",
      message: `role '${binding.role}' is bound to ${quote(binding.code)}, which no layer or node declares and which is no default code`,
      fix: `declare ${quote(binding.code)} in 'errors', or bind the role to a registered code`,
      pointer,
    });

    return undefined;
  }

  const read = deriveErrorsReadRoleParams(site);

  if (read.refused) return read;

  if (!checkRequiredData(check, site, read.params)) return REFUSED;

  if (read.params === undefined) return read;

  return deriveErrorsCheckRoleParamTypes(site, read.params) ? read : REFUSED;
}

const REFUSED: DeriveErrorsRoleParams = { refused: true };

/** The params each checked binding gives, by `deriveErrorsBindingKey`; a binding refused or unregistered is absent. */
export type DeriveErrorsBoundParams = ReadonlyMap<string, DeriveErrorsRoleParams>;

/** The key of a binding in `DeriveErrorsBoundParams`: its pointer, or its role for a default binding. */
export const deriveErrorsBindingKey = (binding: DeriveErrorsBinding): string =>
  binding.pointer ?? `default ${binding.role}`;

// A binding the check reads, keyed so a default binding whose check a written binding repeats is checked once.
const plainBindingKey = (role: DerivationRoleName, code: IrWriter.ErrorCode): string =>
  `${role} ${code}`;

/**
 * Checks every written binding (`conventions.errors.derived` and each node's `errorRoles`), and each default binding
 * whose default code a layer or node redeclares, located at that declaration.
 */
export function deriveErrorsCheckBindings(
  check: DeriveErrorsBindingCheck,
): DeriveErrorsBoundParams {
  const { context, registry } = check;
  const written = nodeBindings(context);
  const bound = new Map<string, DeriveErrorsRoleParams>();
  const record = (binding: DeriveErrorsBinding, pointer: string): void => {
    const params = checkBinding(check, binding, pointer);

    if (params !== undefined) bound.set(deriveErrorsBindingKey(binding), params);
  };

  // A written binding without params to the same code checks the same data and is located nearer the author.
  const writtenPlain = new Set(
    written
      .filter((binding) => binding.params === undefined)
      .map((binding) => plainBindingKey(binding.role, binding.code)),
  );

  for (const role of derivationRoles) {
    const binding = deriveErrorsApiBinding(context, role.role);
    const redeclared = registry.get(binding.code)?.pointer;
    const repeated =
      binding.pointer === undefined && writtenPlain.has(plainBindingKey(role.role, binding.code));
    const pointer = binding.pointer ?? redeclared;

    if (pointer !== undefined && !repeated) record(binding, pointer);
  }

  for (const binding of written)
    if (binding.pointer !== undefined) record(binding, binding.pointer);

  return bound;
}

function nodeBindings(context: DeriveErrorsContext): DeriveErrorsBinding[] {
  const bindings: DeriveErrorsBinding[] = [];

  for (const node of pipelineTreeNodes(context.raw)) {
    const roles = deriveErrorsMember(node.settings, "errorRoles");

    if (!pipelineIsJsonObject(roles)) continue;

    for (const [name, value] of Object.entries(roles))
      bindings.push(
        writtenBinding(
          roleOf(name).role,
          value,
          pipelinePointerBelow(node.pointer, "errorRoles", name),
        ),
      );
  }

  return bindings;
}
