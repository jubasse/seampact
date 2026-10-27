import { type ContractIR, isKnownVariant, type Operation } from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";
import type { ExportRef, TypesDescriptor } from "../descriptors.js";
import { importSpecifier } from "../import-specifier.js";
import { below, operationLocation } from "../ir-location.js";
import type { Link } from "../links.js";
import { refuseInconsistentIr } from "../located-refusals.js";
import { ExportNames, typeScriptIdentifier } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import { SERVER_RUNTIME_PACKAGE } from "./server-runtime-check.js";

// The framework-neutral types of a Node server boundary, typed from the types link: the handler interface of each
// resource (ADR 0007 `handlers: perResource`) and the hook types the app registers.

const HOOKS_PACKAGE = "@seampact/hooks";
const WORD = /[a-z0-9]+/g;
const OPERATION_ACCESS_EXPORT = "OperationAccess";
const HANDLER_INPUTS_EXPORT = "HandlerInputs";

class TypeImports {
  private readonly aliases = new Map<string, string>();

  constructor(
    private readonly link: Link<"types">,
    private readonly fromFile: string,
  ) {}

  reference(ref: ExportRef): string {
    let alias = this.aliases.get(ref.module);

    if (alias === undefined) {
      alias = `types${this.aliases.size}`;
      this.aliases.set(ref.module, alias);
    }

    return `${alias}.${ref.export}`;
  }

  lines(): string[] {
    return [...this.aliases].map(
      ([module, alias]) =>
        `import type * as ${alias} from "${importSpecifier(this.link, { module, export: "" }, this.fromFile)}";`,
    );
  }
}

/** The name of an operation's method, decorator and handler member (ADR 0007 `operation` role). */
export function operationIdentifier(operation: Operation): string {
  return typeScriptIdentifier(deriveName(operation.name.segments, "operation"));
}

/** The handler interface of an operation: a resource's operations share one, one without a resource joins its surface's. */
export function handlerInterfaceName(ir: ContractIR, operation: Operation): string {
  const owner =
    operation.resource?.type ??
    ir.api.surfaces[operation.surface]?.name.segments.join(" ") ??
    operation.surface;

  return typeScriptIdentifier(
    deriveName(owner.toLowerCase().match(WORD) ?? [operation.surface], "endpoints"),
  );
}

/**
 * What a handler method takes: its input alone, or its input then the arguments the app's param decorators give
 * (NestJS), which a method compares bivariantly, so a method may declare them with their own types.
 */
export type HandlerParameters = "inputOnly" | "inputThenDecorated";

/**
 * The handlers module: one interface per resource, each method taking the operation's input with the caller's
 * read-only `principal` and `scopes`.
 */
export function handlersSource(
  ir: ContractIR,
  types: Link<"types">,
  fromFile: string,
  parameters: HandlerParameters,
  refusals: Refusal[],
): string {
  const trailing = parameters === "inputThenDecorated" ? ", ...decorated: unknown[]" : "";
  const imports = new TypeImports(types, fromFile);
  const groups = new Map<string, string[]>();
  const accessMembers: string[] = [];
  const inputMembers: string[] = [];
  const names = new ExportNames(fromFile);

  names.claim(OPERATION_ACCESS_EXPORT, { member: "the generated access map" }, refusals);
  names.claim(HANDLER_INPUTS_EXPORT, { member: "the generated handler input map" }, refusals);

  ir.operations.forEach((operation, index) => {
    const location = operationLocation(index, operation.id);
    const exports = Object.hasOwn(types.descriptor.operations, operation.id)
      ? types.descriptor.operations[operation.id]
      : undefined;

    if (exports === undefined) {
      refusals.push(
        refuseInconsistentIr(
          "link.types.operation.missing",
          "The types link has no types for this operation",
          location,
        ),
      );

      return;
    }

    const group = handlerInterfaceName(ir, operation);
    const members = groups.get(group) ?? [];

    if (members.length === 0) names.claim(group, below(location, "resource"), refusals);

    const method = operationIdentifier(operation);
    const accessKey = JSON.stringify(method);

    accessMembers.push(
      `  readonly ${accessKey}: ${handlerAccessType(ir, operation, types.descriptor, imports)};`,
    );
    inputMembers.push(
      `  readonly ${accessKey}: ${imports.reference(exports.input)} & ${OPERATION_ACCESS_EXPORT}[${accessKey}];`,
    );
    members.push(
      `  ${method}(input: ${HANDLER_INPUTS_EXPORT}[${accessKey}]${trailing}): Awaitable<${imports.reference(exports.output)} | ${imports.reference(exports.errors)}>;`,
    );
    groups.set(group, members);
  });

  const interfaces = [...groups].map(
    ([group, members]) =>
      `/** The handlers a controller implements; each returns a declared success or error. */\nexport interface ${group} {\n${members.join("\n")}\n}`,
  );

  const body = [
    "/** What each operation's handler reads of its caller: the principal (null when anonymous) and the resolved scopes. */",
    `export type ${OPERATION_ACCESS_EXPORT} = {\n${accessMembers.join("\n")}\n};`,
    "",
    "/** The input each operation's handler receives: the validated input with its caller's read-only members. */",
    `export type ${HANDLER_INPUTS_EXPORT} = {\n${inputMembers.join("\n")}\n};`,
    "",
    interfaces.join("\n\n"),
  ].join("\n");

  return [
    importLine(["Awaitable", "ResolvedScope"], HOOKS_PACKAGE, body),
    ...imports.lines(),
    "",
    body,
    "",
  ].join("\n");
}

// What the operation's handler reads of its caller: the principal unless the route is public (null for an
// anonymous caller on an optional-auth route), and each scope the operation runs in, as its resolver answered it.
function handlerAccessType(
  ir: ContractIR,
  operation: Operation,
  descriptor: TypesDescriptor,
  imports: TypeImports,
): string {
  const access = operation.access;
  // The hooks module reports a missing principal type; it names the same identities.
  const reportedByHooksModule: Refusal[] = [];
  const principal =
    access.kind === "public" || !("identity" in access)
      ? undefined
      : principalType(ir, String(access.identity), descriptor, imports, reportedByHooksModule);
  const scopes = operation.scopes.map(
    (scope) => `readonly ${JSON.stringify(scope.scope)}: ResolvedScope`,
  );
  const members = [
    ...(principal === undefined
      ? []
      : [`readonly principal: ${access.kind === "optional" ? `${principal} | null` : principal}`]),
    ...(scopes.length === 0 ? [] : [`readonly scopes: { ${scopes.join("; ")} }`]),
  ];

  return members.length === 0 ? "Record<never, never>" : `{ ${members.join("; ")} }`;
}

/** The hooks module: the hook types of each identity, right, rule and scope, and the registration object. */
export function hookTypesSource(
  ir: ContractIR,
  types: Link<"types">,
  fromFile: string,
  refusals: Refusal[],
): string {
  const imports = new TypeImports(types, fromFile);
  const denialOf = denialTypes(ir, types.descriptor, imports);
  const principalOf = (identityId: string): string =>
    principalType(ir, identityId, types.descriptor, imports, refusals);
  const identitiesOf = (operations: readonly Operation[]): string => {
    const principals = [
      ...new Set(
        operations.map((operation) =>
          operation.access.kind === "public" || !("identity" in operation.access)
            ? "null"
            : principalOf(String(operation.access.identity)),
        ),
      ),
    ];

    return principals.join(" | ");
  };

  const authenticate = Object.keys(ir.identities)
    .filter((identityId) =>
      ir.operations.some(
        (operation) => "identity" in operation.access && operation.access.identity === identityId,
      ),
    )
    .map((identityId) => {
      const identity = ir.identities[identityId];
      const schemes =
        identity !== undefined &&
        isKnownVariant("Identity", identity) &&
        identity.kind === "credential"
          ? [
              ...new Set([
                ...identity.schemes.read,
                ...identity.schemes.write,
                ...identity.schemes.optionalRead,
              ]),
            ]
          : [];
      const credentials = schemes
        .map((scheme) => `readonly ${JSON.stringify(scheme)}?: string`)
        .join("; ");
      const declared =
        identity !== undefined && isKnownVariant("Identity", identity) ? identity.errors : [];
      const codes = denialOf(declared.length > 0 ? declared : unauthenticatedCodes(ir, identityId));

      return `  readonly ${JSON.stringify(identityId)}: AuthenticateHook<AuthenticateRequest<{ ${credentials} }>, ${principalOf(identityId)}, ${codes}>;`;
    });

  const deciders = requirementNames(ir).map(([name, codes, operations]) => {
    return `  readonly ${JSON.stringify(name)}: RequirementRequest<${denialOf(codes)}, unknown, ${identitiesOf(operations)}>;`;
  });

  const scopes = Object.entries(ir.scopes)
    .filter(([scopeId]) =>
      ir.operations.some((operation) => operation.scopes.some((scope) => scope.scope === scopeId)),
    )
    .map(([scopeId, scope]) => {
      const operations = ir.operations.filter((operation) =>
        operation.scopes.some((used) => used.scope === scopeId),
      );

      return `  readonly ${JSON.stringify(scopeId)}: ResolveScopeHook<ResolveScopeRequest<unknown, ${identitiesOf(operations)}>, ResolvedScope, ${denialOf(scope.errors)}>;`;
    });

  const idempotent = ir.operations.some(
    (operation) => operation.idempotency !== undefined && operation.idempotency.kind !== "exempt",
  );

  // A member no operation needs is optional, so an api with none asks the app for no hooks at all.
  const optionalWhenEmpty = (members: readonly unknown[]): string =>
    members.length === 0 ? "?" : "";
  const body = [
    "/** The authenticate hook of each identity an operation uses. */",
    `export type AuthenticateHooks = {\n${authenticate.join("\n")}\n};`,
    "",
    "/** What the decider of each right and rule receives. */",
    `export type DeciderRequests = {\n${deciders.join("\n")}\n};`,
    "",
    "/** A decider of some rights and rules, by name, or of all of them. */",
    "export type DeciderEntry = DeciderRegistration<keyof DeciderRequests, DecideHook<DeciderRequests[keyof DeciderRequests]>>;",
    "",
    "/** The resolver of each scope kind an operation uses. */",
    `export type ScopeResolvers = {\n${scopes.join("\n")}\n};`,
    "",
    "/** Every hook the api's boundary calls, as the app registers them; none when every operation is public. */",
    "export type SeampactHooks = {",
    `  readonly authenticate${optionalWhenEmpty(authenticate)}: AuthenticateHooks;`,
    `  readonly deciders${optionalWhenEmpty(deciders)}: readonly DeciderEntry[];`,
    `  readonly scopeResolvers${optionalWhenEmpty(scopes)}: ScopeResolvers;`,
    `  readonly idempotencyStore${idempotent ? "" : "?"}: IdempotencyStore;`,
    "  readonly onUnexpectedError?: UnexpectedErrorHook;",
    "};",
    "",
  ].join("\n");

  return [
    importLine(
      [
        "AuthenticateHook",
        "AuthenticateRequest",
        "DecideHook",
        "IdempotencyStore",
        "RequirementRequest",
        "ResolvedScope",
        "ResolveScopeHook",
        "ResolveScopeRequest",
      ],
      HOOKS_PACKAGE,
      body,
    ),
    importLine(["DeciderRegistration", "UnexpectedErrorHook"], SERVER_RUNTIME_PACKAGE, body),
    ...imports.lines(),
    "",
    body,
  ].join("\n");
}

// An import of the names the body uses, so a strict consumer's `noUnusedLocals` finds none unused.
function importLine(names: readonly string[], from: string, body: string): string {
  const used = names.filter((name) => new RegExp(`\\b${name}\\b`).test(body));

  return `import type { ${used.join(", ")} } from "${from}";`;
}

function unauthenticatedCodes(ir: ContractIR, identityId: string): string[] {
  const codes = ir.operations
    .filter(
      (operation) => "identity" in operation.access && operation.access.identity === identityId,
    )
    .flatMap((operation) =>
      operation.errors.filter((error) =>
        error.roles?.some((binding) => binding.role === "unauthenticated"),
      ),
    )
    .map((error) => error.code);

  return [...new Set(codes)];
}

// Each right and rule an operation asks, with its denial codes and the operations that ask it.
function requirementNames(
  ir: ContractIR,
): [name: string, codes: string[], operations: Operation[]][] {
  const byName = new Map<string, [string[], Operation[]]>();

  const add = (name: string, codes: readonly string[], operation: Operation): void => {
    const entry = byName.get(name) ?? [[...codes], []];

    entry[1].push(operation);
    byName.set(name, entry);
  };

  for (const operation of ir.operations) {
    for (const requirement of operation.requires) {
      if (requirement.kind === "right" && "right" in requirement) {
        add(requirement.right, ir.rights[requirement.right]?.errors ?? [], operation);
      } else if (requirement.kind === "rule" && "rule" in requirement) {
        add(requirement.rule, ir.rules[requirement.rule]?.errors ?? [], operation);
      }
    }

    for (const fieldRight of operation.fieldRights) {
      add(fieldRight.right, ir.rights[fieldRight.right]?.errors ?? [], operation);
    }
  }

  return [...byName].map(([name, [codes, operations]]) => [name, codes, operations]);
}

// A code's denial type: the code with its params as an operation's errors type declares them.
function denialTypes(
  ir: ContractIR,
  descriptor: TypesDescriptor,
  imports: TypeImports,
): (codes: readonly string[]) => string {
  return (codes) => {
    if (codes.length === 0) return "never";

    return codes
      .map((code) => {
        const operation = ir.operations.find((candidate) =>
          candidate.errors.some((error) => error.code === code),
        );
        const errors =
          operation === undefined ? undefined : descriptor.operations[operation.id]?.errors;

        return errors === undefined
          ? `{ readonly code: ${JSON.stringify(code)}; readonly params?: unknown }`
          : `Omit<Extract<${imports.reference(errors)}, { code: ${JSON.stringify(code)} }>, "status">`;
      })
      .join(" | ");
  };
}

function principalType(
  ir: ContractIR,
  identityId: string,
  descriptor: TypesDescriptor,
  imports: TypeImports,
  refusals: Refusal[],
): string {
  const identity = ir.identities[identityId];
  const principal =
    identity !== undefined && isKnownVariant("Identity", identity) ? identity.principal : undefined;

  if (
    principal === undefined ||
    !isKnownVariant("Principal", principal) ||
    principal.kind !== "schema"
  ) {
    return "unknown";
  }

  const ref = descriptor.schemas[principal.schema]?.output;

  if (ref === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "link.types.schema.missing",
        `The types link has no output type for the principal '${principal.schema}'`,
        below({ member: "" }, "identities", identityId),
      ),
    );

    return "unknown";
  }

  return imports.reference(ref);
}
