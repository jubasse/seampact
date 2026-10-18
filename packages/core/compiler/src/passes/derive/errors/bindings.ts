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
import { quote } from "../../../validate/diagnostics.js";
import { type DeriveErrorsRawValue, deriveErrorsMember, deriveErrorsString } from "./read.js";
import type { DeriveErrorsContext, DeriveErrorsRegistry } from "./registry.js";
import type { DeriveErrorsReporter } from "./report.js";

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

// A slot of the template language (grammar 13 "Templates") that reads the datum: `$datum`, `$datum.member`, or
// `${datum}` inside a text. `$$` writes a literal `$`, so `$$datum` reads nothing.
function readsDatum(text: string, datum: string): boolean {
  const unescaped = text.replaceAll("$$", "");

  return (
    unescaped === `$${datum}` ||
    unescaped.startsWith(`$${datum}.`) ||
    unescaped.includes(`\${${datum}}`)
  );
}

function templateReaches(template: DeriveErrorsRawValue, datum: string): boolean {
  if (typeof template === "string") return readsDatum(template, datum);

  if (Array.isArray(template)) return template.some((item) => templateReaches(item, datum));

  if (!pipelineIsJsonObject(template)) return false;

  return Object.entries(template).some(
    ([key, value]) => readsDatum(key, datum) || templateReaches(value, datum),
  );
}

function paramNames(
  params: IrWriter.SchemaRef | undefined,
  schemas: PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>,
): Set<string> {
  if (params === undefined || !Object.hasOwn(schemas, params)) return new Set();

  const schema = schemas[params];

  return schema?.kind === "object"
    ? new Set(schema.properties.map((property) => property.name))
    : new Set();
}

// The data a binding must carry api-wide. `rateLimited`'s delay is required once `conventions.rateLimit` names its
// param; `forbidden`'s pointer depends on each operation's restricted input fields, so it is checked per operation.
function requiredData(context: DeriveErrorsContext, role: DerivationRole): DerivationRoleDatum[] {
  const rateLimitNamed = context.conventions.get("rateLimit.param") !== undefined;

  return role.data.filter(
    (datum) =>
      datum.required === "always" ||
      (datum.required === "conditional" && role.role === "rateLimited" && rateLimitNamed),
  );
}

/** What the binding checks read and report through. */
export interface DeriveErrorsBindingCheck {
  readonly context: DeriveErrorsContext;
  readonly reporter: DeriveErrorsReporter;
  readonly registry: DeriveErrorsRegistry;
  readonly schemas: PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;
}

// The params a written template fills: each top-level key that names a param of the code, with the template written
// under it (a param name never starts with `$`). A key that names no param is refused, so no datum is carried nowhere.
function filledParams(
  check: DeriveErrorsBindingCheck,
  binding: DeriveErrorsBinding,
  names: ReadonlySet<string>,
  pointer: string,
): Map<string, DeriveErrorsRawValue> {
  const filled = new Map<string, DeriveErrorsRawValue>();
  const { params } = binding;

  if (params === undefined) return filled;

  const paramsPointer = pipelinePointerBelow(pointer, "params");

  if (!pipelineIsJsonObject(params)) {
    check.reporter.error({
      rule: "role-param",
      message: `the params template of role '${binding.role}' is no object, so it fills no param of ${quote(binding.code)}`,
      fix: "write params as an object whose keys are params of the code: { <param>: $<datum> }",
      pointer: paramsPointer,
    });

    return filled;
  }

  for (const [key, value] of Object.entries(params)) {
    if (names.has(key)) {
      filled.set(key, value);
      continue;
    }

    check.reporter.error({
      rule: "role-param",
      message: `the params template of role '${binding.role}' writes ${quote(key)}, which is no param of ${quote(binding.code)}`,
      fix: `write only params of ${quote(binding.code)} as keys, or add a param ${quote(key)} to it`,
      pointer: pipelinePointerBelow(paramsPointer, key),
    });
  }

  return filled;
}

function checkBinding(
  check: DeriveErrorsBindingCheck,
  binding: DeriveErrorsBinding,
  pointer: string,
): void {
  const { context, reporter, registry, schemas } = check;
  const registered = registry.get(binding.code);

  if (registered === undefined) {
    reporter.error({
      rule: "role-code",
      message: `role '${binding.role}' is bound to ${quote(binding.code)}, which no layer or node declares and which is no default code`,
      fix: `declare ${quote(binding.code)} in 'errors', or bind the role to a registered code`,
      pointer,
    });

    return;
  }

  const names = paramNames(registered.declaration.params, schemas);
  const filled = filledParams(check, binding, names, pointer);

  for (const datum of requiredData(context, roleOf(binding.role))) {
    const reached =
      binding.params === undefined
        ? names.has(datum.name)
        : [...filled.values()].some((template) => templateReaches(template, datum.name));

    if (reached) continue;

    reporter.error({
      rule: "role-datum",
      message: `role '${binding.role}' requires the datum '${datum.name}', which no param of ${quote(binding.code)} receives`,
      fix: `add a param '${datum.name}' to ${quote(binding.code)}, or bind it with params: { <param>: $${datum.name} }`,
      pointer,
    });
  }
}

// A binding the check reads, keyed so a default binding whose check a written binding repeats is checked once.
const plainBindingKey = (role: DerivationRoleName, code: IrWriter.ErrorCode): string =>
  `${role} ${code}`;

/**
 * Checks every written binding (`conventions.errors.derived` and each node's `errorRoles`), and each default binding
 * whose default code a layer or node redeclares, located at that declaration.
 */
export function deriveErrorsCheckBindings(check: DeriveErrorsBindingCheck): void {
  const { context, registry } = check;
  const written = nodeBindings(context);

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

    if (pointer !== undefined && !repeated) checkBinding(check, binding, pointer);
  }

  for (const binding of written)
    if (binding.pointer !== undefined) checkBinding(check, binding, binding.pointer);
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
