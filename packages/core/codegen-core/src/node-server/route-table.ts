import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type Param,
  type Template,
  type TypeUse,
  type WireFormat,
} from "@seampact/spec/ir";
import type { ValidatorsDescriptor } from "../descriptors.js";
import { type GenerateWarning, warnLeftToHandler } from "../generate-warning.js";
import { importSpecifier } from "../import-specifier.js";
import { below, type IrLocation, operationLocation } from "../ir-location.js";
import type { Link } from "../links.js";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "../located-refusals.js";
import type { Refusal } from "../refusal.js";

// The route table module of one api: every operation as the node-server runtime reads it (`ContractApi`), with
// the validators link's input validator per operation. A form the runtime does not serve is refused by name.

export interface RouteTableOptions {
  /** The module that holds the runtime's types, relative to the route table module, as `./node-server/contract-route.js`. */
  readonly runtimeModule: string;
  /** Adds each JSON response's item validator, for the target option `bodyValidation`. */
  readonly withItemValidators: boolean;
}

const API_LOCATION: IrLocation = { member: "" };
const JSON_MEDIA = "application/json";
const BOUNDARY_ENFORCEMENT = "boundary";
const CURSOR_ROLE = "cursor";
const LIMIT_ROLE = "limit";

// A value written into the module as source text, such as an imported validator.
class SourceExpression {
  constructor(readonly text: string) {}
}

type SourceValue =
  | SourceExpression
  | string
  | number
  | boolean
  | undefined
  | null
  | readonly SourceValue[]
  | { readonly [member: string]: SourceValue };

/**
 * The route table module source, or the refusals of every form it cannot serve; `warnings` gets each form the
 * boundary leaves to the handler.
 */
export function routeTableSource(
  ir: ContractIR,
  validators: Link<"validators">,
  fromFile: string,
  options: RouteTableOptions,
  refusals: Refusal[],
  warnings: GenerateWarning[],
): string {
  const imports = new ModuleImports(validators, fromFile);
  const format = errorFormat(ir, refusals);

  ir.operations.forEach((operation, index) => {
    warnings.push(...handlerForms(ir, operation, operationLocation(index, operation.id)));
  });

  const routes = ir.operations.map((operation, index) =>
    routeEntry(
      ir,
      operation,
      operationLocation(index, operation.id),
      validators.descriptor,
      imports,
      options,
      refusals,
    ),
  );
  const shapes = outputShapes(ir, refusals);

  if (ir.api.wire.urls !== "relative") {
    refusals.push(
      ir.api.wire.urls === "absolute"
        ? refuseNotGeneratedYet(
            "wire.urls.absolute",
            "Absolute URLs",
            below(API_LOCATION, "api", "wire", "urls"),
          )
        : refuseUnknownValueAt(below(API_LOCATION, "api", "wire", "urls"), ir.api.wire.urls),
    );
  }

  const table: SourceValue = { id: ir.api.id, format, routes, shapes };

  return [
    `import type { ContractApi } from "${options.runtimeModule}";`,
    ...imports.lines(),
    "",
    "/** Every operation of the api as the boundary checks it. */",
    `export const CONTRACT_API: ContractApi = ${sourceOf(table)};`,
    "",
  ].join("\n");
}

class ModuleImports {
  private readonly aliases = new Map<string, string>();

  constructor(
    private readonly link: Link<"validators">,
    private readonly fromFile: string,
  ) {}

  expression(module: string, exportName: string): SourceExpression {
    let alias = this.aliases.get(module);

    if (alias === undefined) {
      alias = `validators${this.aliases.size}`;
      this.aliases.set(module, alias);
    }

    return new SourceExpression(`${alias}.${exportName}`);
  }

  lines(): string[] {
    return [...this.aliases].map(
      ([module, alias]) =>
        `import * as ${alias} from "${importSpecifier(this.link, { module, export: "" }, this.fromFile)}";`,
    );
  }
}

function routeEntry(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
  validators: ValidatorsDescriptor,
  imports: ModuleImports,
  options: RouteTableOptions,
  refusals: Refusal[],
): SourceValue {
  refuseOperationForms(operation, location, refusals);

  const validatorRef = Object.hasOwn(validators.operations, operation.id)
    ? validators.operations[operation.id]?.input
    : undefined;

  if (validatorRef === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "link.validators.operation.missing",
        "The validators link has no input validator for this operation",
        location,
      ),
    );
  }

  return {
    id: operation.id,
    method: operation.method,
    path: operation.path,
    safe: operation.safe,
    access: accessEntry(ir, operation, location, refusals),
    scopes: operation.scopes.map((scope, index) => ({
      scope: scope.scope,
      source: valueSource(
        scope.source,
        below(location, "scopes", String(index), "source"),
        refusals,
      ),
      errors: ir.scopes[scope.scope]?.errors ?? [],
    })),
    requires: operation.requires.map((requirement, index) =>
      requirementEntry(ir, requirement, below(location, "requires", String(index)), refusals),
    ),
    fieldRights: operation.fieldRights.map((fieldRight, index) => {
      const fieldLocation = below(location, "fieldRights", String(index));

      if (fieldRight.direction === "input" && !/^\/[^/]+$/.test(fieldRight.pointer)) {
        refusals.push(
          refuseNotGeneratedYet(
            "fieldRight.nestedPointer",
            "An input field right below the top level",
            below(fieldLocation, "pointer"),
          ),
        );
      }

      return {
        direction: fieldRight.direction,
        pointer: fieldRight.pointer,
        right: fieldRight.right,
        schema: fieldRight.schema,
        params: jsonValue(fieldRight.params),
        subject:
          fieldRight.subject === undefined
            ? undefined
            : {
                type: subjectType(ir, fieldRight.right),
                source: valueSource(
                  fieldRight.subject.source,
                  below(fieldLocation, "subject"),
                  refusals,
                ),
              },
        inputPolicy: fieldRight.inputPolicy,
        errors: ir.rights[fieldRight.right]?.errors ?? [],
      };
    }),
    params: {
      path: operation.params.path.map((param) => paramRule(param, param.name)),
      query: operation.params.query.map((param) => queryRule(param, location, refusals)),
      headers: operation.params.header.map((param) => paramRule(param, param.name.toLowerCase())),
    },
    input: inputEntry(operation, location, refusals),
    validator:
      validatorRef === undefined
        ? null
        : imports.expression(validatorRef.module, validatorRef.export),
    idempotency: idempotencyEntry(operation, location, refusals),
    responses: operation.responses.map((response, index) => ({
      status: response.status,
      shape: response.shape,
      body:
        response.body === undefined
          ? undefined
          : valueShape(
              response.body,
              below(location, "responses", String(index), "body"),
              refusals,
            ),
      itemValidator: options.withItemValidators
        ? itemValidator(response.body, validators, imports)
        : undefined,
    })),
    errors: Object.fromEntries(
      operation.errors.map((error, index) => [
        error.code,
        errorEntry(ir, error, below(location, "errors", String(index)), refusals),
      ]),
    ),
    paging: pagingEntry(ir, operation, location, refusals),
    cache:
      operation.cache === undefined
        ? undefined
        : {
            etag: operation.cache.etag,
            cacheControl: Object.fromEntries(
              operation.cache.perCallerKind.map((entry) => [entry.caller, entry.cacheControl]),
            ),
            noStore: operation.cache.noStore,
            vary: operation.cache.vary,
          },
  };
}

// Forms the boundary validates or passes on but does not enforce: the handler does (ADR 0016 "Left to the handler").
// `filteredBy` is not one: grammar section 10 makes it the application's by design, so it is no warning.
function handlerForms(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
): GenerateWarning[] {
  const access = operation.access;
  const identityId =
    isKnownVariant("Access", access) && access.kind !== "public" ? access.identity : undefined;
  const identity = identityId === undefined ? undefined : ir.identities[identityId];
  const identityHeaders =
    identity !== undefined && isKnownVariant("Identity", identity) && "headers" in identity
      ? identity.headers.length
      : 0;
  const forms: [
    form: string,
    description: string,
    present: boolean,
    member: string,
    fix: string,
  ][] = [
    [
      "concurrency",
      "The version check",
      operation.concurrency !== undefined,
      "concurrency",
      "Compare the version in the input with the stored one and answer the stateConflict code when they differ.",
    ],
    [
      "owner",
      "The caller ownership",
      operation.owner !== undefined,
      "owner",
      "Scope the handler's reads and writes to the authenticated principal.",
    ],
    [
      "deadline",
      "The request deadline",
      operation.deadlineHeader !== undefined || operation.budgetMs !== undefined,
      operation.deadlineHeader === undefined ? "budgetMs" : "deadlineHeader",
      "Read the deadline header the boundary validated and stop the work when it passes.",
    ],
    [
      "paging.sortKeys",
      "The sort keys",
      (operation.paging?.sortKeys.length ?? 0) > 0,
      "paging",
      "Order the page by the sort key the boundary validated.",
    ],
    [
      "identity.headers",
      `The headers of the identity '${identityId ?? ""}'`,
      identityHeaders > 0,
      "access",
      "Read the identity headers the boundary validated in the handler.",
    ],
  ];

  return forms.flatMap(([form, description, present, member, fix]) =>
    present ? [warnLeftToHandler(form, description, below(location, member), fix)] : [],
  );
}

// Forms the reference contract does not hold, refused until a consumer needs them (A47).
function refuseOperationForms(
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): void {
  const absentForms: [form: string, description: string, present: boolean, member: string][] = [
    [
      "principalRequires",
      "A principal requirement",
      operation.principalRequires.length > 0,
      "principalRequires",
    ],
    ["bindings", "A principal binding", operation.bindings.length > 0, "bindings"],
    ["upstream", "An upstream service call", operation.upstream.length > 0, "upstream"],
    ["degradable", "A degradable operation", operation.degradable !== undefined, "degradable"],
    ["features", "An operation feature", operation.features.length > 0, "features"],
    [
      "extensions",
      "An operation extension value",
      Object.keys(operation.extensions).length > 0,
      "extensions",
    ],
    [
      "paging.sortKey.restricted",
      "A restricted sort key",
      (operation.paging?.sortKeys ?? []).some((key) => "restrictedTo" in key),
      "paging",
    ],
  ];

  for (const [form, description, present, member] of absentForms) {
    if (present) refusals.push(refuseNotGeneratedYet(form, description, below(location, member)));
  }
}

function accessEntry(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const access = operation.access;
  const accessLocation = below(location, "access");

  if (!isKnownVariant("Access", access)) {
    refusals.push(refuseUnknownValueAt(below(accessLocation, "kind"), access.kind));

    return null;
  }

  if (access.kind === "public") return { kind: "public" };

  if (access.kind === "optional") {
    refusals.push(
      refuseNotGeneratedYet("access.optional", "Optional authentication", accessLocation),
    );

    return null;
  }

  const identity = ir.identities[access.identity];

  if (identity === undefined || !isKnownVariant("Identity", identity)) {
    refusals.push(
      refuseInconsistentIr(
        "identity.unresolved",
        `The identity '${access.identity}' is not declared`,
        accessLocation,
      ),
    );

    return null;
  }

  const anonymousAllowed = operation.callerKinds.includes("anonymous");
  const csrf = operation.csrf;
  const csrfHeader =
    csrf !== undefined && isKnownVariant("Csrf", csrf) && csrf.kind === "derived"
      ? csrf.header
      : undefined;

  if (identity.kind === "signed") {
    return {
      kind: "identity",
      identity: access.identity,
      anonymousAllowed,
      credentials: [],
      signed: signedSource(ir, identity.signed, accessLocation, refusals),
    };
  }

  return {
    kind: "identity",
    identity: access.identity,
    anonymousAllowed,
    credentials: access.schemes.map((schemeId) =>
      credentialSource(ir, schemeId, accessLocation, refusals),
    ),
    csrfHeader,
  };
}

function credentialSource(
  ir: ContractIR,
  schemeId: string,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const scheme = ir.schemes[schemeId];

  if (scheme === undefined || !isKnownVariant("Scheme", scheme)) {
    refusals.push(
      refuseInconsistentIr(
        "scheme.unresolved",
        `The scheme '${schemeId}' is not declared or not known`,
        location,
      ),
    );

    return null;
  }

  switch (scheme.kind) {
    case "bearer":
      return { scheme: schemeId, in: "bearer" };
    case "cookie":
      return { scheme: schemeId, in: "cookie", name: scheme.name };
    case "header":
      return { scheme: schemeId, in: "header", name: (scheme.name ?? schemeId).toLowerCase() };
    default:
      refusals.push(
        refuseNotGeneratedYet(
          `scheme.${scheme.kind}`,
          `A '${scheme.kind}' credential scheme`,
          location,
        ),
      );

      return null;
  }
}

function signedSource(
  ir: ContractIR,
  schemeId: string,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const scheme = ir.schemes[schemeId];

  if (scheme === undefined || !isKnownVariant("Scheme", scheme) || scheme.kind !== "signature") {
    refusals.push(
      refuseInconsistentIr(
        "scheme.unresolved",
        `The signature scheme '${schemeId}' is not declared`,
        location,
      ),
    );

    return null;
  }

  const signature = scheme.signature;

  if (signature.verify !== "template" || !("payload" in signature)) {
    refusals.push(
      refuseNotGeneratedYet(
        "signature.application",
        "A signature verified by the application",
        location,
      ),
    );

    return null;
  }

  if (!isKnownVariant("SchemeKey", signature.key) || signature.key.kind !== "value") {
    refusals.push(
      refuseNotGeneratedYet(
        "signature.key.source",
        "A signature key read from the request",
        location,
      ),
    );

    return null;
  }

  if (scheme.name === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "scheme.signature.header",
        `The signature scheme '${schemeId}' names no header`,
        location,
      ),
    );

    return null;
  }

  return {
    scheme: schemeId,
    header: scheme.name.toLowerCase(),
    format: signature.format,
    keyId: signature.key.value,
    template: {
      algorithm: signature.algorithm,
      payload: signature.payload,
      encoding: signature.encoding,
      toleranceMs: signature.toleranceMs,
    },
  };
}

function requirementEntry(
  ir: ContractIR,
  requirement: Operation["requires"][number],
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  if (!isKnownVariant("Requirement", requirement)) {
    refusals.push(refuseUnknownValueAt(below(location, "kind"), requirement.kind));

    return null;
  }

  if (requirement.kind === "right") {
    return {
      kind: "right",
      name: requirement.right,
      params: jsonValue(requirement.params),
      subject:
        requirement.subject === undefined
          ? undefined
          : {
              type: subjectType(ir, requirement.right),
              source: valueSource(requirement.subject.source, below(location, "subject"), refusals),
            },
      errors: ir.rights[requirement.right]?.errors ?? [],
    };
  }

  const rule = ir.rules[requirement.rule];
  const proof = rule?.proof;

  if (proof !== undefined && proof.in !== "body") {
    refusals.push(
      refuseNotGeneratedYet("rule.proof.placement", `A rule proof in '${proof.in}'`, location),
    );
  }

  const bucket = requirement.bucket === undefined ? undefined : ir.buckets[requirement.bucket];

  return {
    kind: "rule",
    name: requirement.rule,
    params: jsonValue(requirement.params),
    proof: proof?.name,
    bucket:
      bucket === undefined
        ? undefined
        : {
            id: bucket.id,
            key: bucket.key.map((source) =>
              valueSource(source, below(location, "bucket"), refusals),
            ),
            limit: bucket.limit,
            windowMs: bucket.windowMs,
          },
    errors: rule?.errors ?? [],
  };
}

function subjectType(ir: ContractIR, rightId: string): string {
  const subject = ir.rights[rightId]?.subject;

  if (subject === undefined || !isKnownVariant("RightSubject", subject)) return rightId;

  if (subject.kind === "resource") return subject.type.segments.join("-");

  if (subject.kind === "scope") return subject.scope;

  return rightId;
}

const VALUE_SOURCES = ["path", "scope", "principal", "holderField"] as const;

function valueSource(
  source: { in: string; name?: string },
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  if (!VALUE_SOURCES.some((known) => known === source.in) || source.name === undefined) {
    refusals.push(
      refuseNotGeneratedYet("valueSource", `A value read from '${source.in}'`, location),
    );
  }

  return { in: source.in, name: source.name };
}

function paramRule(param: Param, name: string): SourceValue {
  return { name, decoding: scalarDecoding(param.type) };
}

function scalarDecoding(type: TypeUse): string {
  if (isKnownVariant("TypeUse", type) && type.kind === "scalar") {
    if (type.type === "integer" || type.type === "number") return "number";

    if (type.type === "boolean") return "boolean";
  }

  return "text";
}

function queryRule(param: Param, location: IrLocation, refusals: Refusal[]): SourceValue {
  const wire = param.wire;

  if (wire === undefined) return paramRule(param, param.name);

  if (wire.style !== "form" || (wire.kind === "list" && (wire.explode || wire.brackets))) {
    refusals.push(
      refuseNotGeneratedYet(
        "query.wire",
        `The query wire form of '${param.name}'`,
        below(location, "params", "query"),
      ),
    );
  }

  const decoding =
    wire.kind === "list"
      ? "list"
      : wire.kind === "number"
        ? "number"
        : wire.kind === "boolean"
          ? "boolean"
          : "text";

  return { name: param.name, decoding };
}

function inputEntry(operation: Operation, location: IrLocation, refusals: Refusal[]): SourceValue {
  const input = operation.input;

  if (input === undefined) return undefined;

  if (input.media !== JSON_MEDIA) {
    refusals.push(
      refuseNotGeneratedYet(
        "input.media",
        `A '${input.media}' request body`,
        below(location, "input", "media"),
      ),
    );
  }

  return { media: input.media, limitBytes: input.bodyLimitBytes, rawBody: input.rawBody };
}

function idempotencyEntry(
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const idempotency = operation.idempotency;

  if (idempotency === undefined) return undefined;

  if (!isKnownVariant("Idempotency", idempotency)) {
    refusals.push(refuseUnknownValueAt(below(location, "idempotency", "kind"), idempotency.kind));

    return undefined;
  }

  if (idempotency.kind === "exempt") return undefined;

  if (idempotency.enforce !== BOUNDARY_ENFORCEMENT) {
    refusals.push(
      refuseNotGeneratedYet(
        "idempotency.enforce",
        `Idempotency enforced by '${idempotency.enforce}'`,
        below(location, "idempotency"),
      ),
    );
  }

  return {
    header: idempotency.header,
    replayHeader: idempotency.replayHeader,
    lifetimeMs: idempotency.lifetimeMs,
  };
}

function errorEntry(
  ir: ContractIR,
  error: Operation["errors"][number],
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const declaration = ir.errors[error.code];

  if (declaration === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "error.unresolved",
        `The error code '${error.code}' is not declared`,
        location,
      ),
    );

    return null;
  }

  const roles =
    error.roles?.map((binding) => binding.role) ??
    (declaration.default === undefined ? [] : [declaration.default]);
  const roleParams = Object.fromEntries(
    (error.roles ?? []).flatMap((binding, index) =>
      binding.params === undefined
        ? []
        : [
            [
              binding.role,
              template(binding.params, below(location, "roles", String(index), "params"), refusals),
            ],
          ],
    ),
  );

  return {
    code: error.code,
    title: declaration.title,
    status: declaration.http.status,
    nature: declaration.nature,
    roles,
    roleParams: Object.keys(roleParams).length === 0 ? undefined : roleParams,
    retryHeader:
      error.retryHeader === undefined
        ? undefined
        : {
            name: error.retryHeader.name,
            param: error.retryHeader.param,
            unit: error.retryHeader.unit,
          },
  };
}

function pagingEntry(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const paging = operation.paging;

  if (paging === undefined) return undefined;

  const style = paging.style === undefined ? undefined : ir.pagings[paging.style];
  const cursor = style?.request.find((role) => role.role === CURSOR_ROLE);
  const nextCursor = style?.handlerResult[0];

  if (
    style === undefined ||
    style.position !== CURSOR_ROLE ||
    cursor === undefined ||
    nextCursor === undefined
  ) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.style",
        `The paging style '${paging.style ?? "(none)"}'`,
        below(location, "paging"),
      ),
    );

    return undefined;
  }

  return {
    cursorParam: cursor.name,
    nextCursorMember: nextCursor,
    limitParam: style.request.find((role) => role.role === LIMIT_ROLE)?.name,
    defaultLimit: paging.defaultLimit,
  };
}

function errorFormat(ir: ContractIR, refusals: Refusal[]): SourceValue {
  const formatIds = [...new Set(ir.operations.map((operation) => operation.format))];
  const formatId = formatIds[0];
  const location = below(API_LOCATION, "formats", formatId ?? "");

  if (formatIds.length > 1) {
    refusals.push(
      refuseNotGeneratedYet("format.several", "Several error formats in one api", location),
    );
  }

  const format: WireFormat | undefined = formatId === undefined ? undefined : ir.formats[formatId];

  if (format === undefined) {
    return {
      media: JSON_MEDIA,
      body: { kind: "object", members: [] },
      codeMember: "code",
      mergeParams: false,
    };
  }

  if (format.error.headers.length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.headers",
        "Error format headers",
        below(location, "error", "headers"),
      ),
    );
  }

  for (const [shape, success] of Object.entries(format.success)) {
    const body = success.body;

    if (
      success.headers.length > 0 ||
      !isKnownVariant("Template", body) ||
      body.kind !== "slot" ||
      body.path.length > 0
    ) {
      refusals.push(
        refuseNotGeneratedYet(
          "format.success.envelope",
          "A success envelope",
          below(location, "success", shape),
        ),
      );
    }
  }

  const body = template(format.error.body, below(location, "error", "body"), refusals);
  const members =
    isKnownVariant("Template", format.error.body) && format.error.body.kind === "object"
      ? format.error.body.members
      : [];
  const codeMembers = members.flatMap((member) =>
    isKnownVariant("MemberName", member.name) &&
    member.name.kind === "text" &&
    isSlot(member.value, "code")
      ? [member.name.text]
      : [],
  );

  return {
    media: format.error.media,
    body,
    codeMember: codeMembers.includes("code") ? "code" : (codeMembers[0] ?? "code"),
    mergeParams:
      isKnownVariant("Template", format.error.body) &&
      format.error.body.kind === "object" &&
      format.error.body.merge === "params",
  };
}

function isSlot(value: Template, slot: string): boolean {
  return isKnownVariant("Template", value) && value.kind === "slot" && value.slot === slot;
}

function template(node: Template, location: IrLocation, refusals: Refusal[]): SourceValue {
  if (isKnownVariant("Template", node)) {
    if (node.kind === "slot") return { kind: "slot", slot: node.slot, path: node.path };

    if (node.kind === "literal") return { kind: "literal", value: jsonValue(node.value) ?? null };

    if (node.kind === "each") {
      return {
        kind: "each",
        of: node.of,
        as: template(node.as, below(location, "as"), refusals),
      };
    }

    if (node.kind === "object") {
      return {
        kind: "object",
        members: node.members.flatMap((member, index) => {
          if (!isKnownVariant("MemberName", member.name) || member.name.kind !== "text") {
            refusals.push(
              refuseNotGeneratedYet(
                "format.memberName",
                "A computed member name",
                below(location, "members", String(index)),
              ),
            );

            return [];
          }

          return [
            {
              name: member.name.text,
              value: template(member.value, below(location, "members", String(index)), refusals),
            },
          ];
        }),
      };
    }
  }

  refusals.push(
    refuseNotGeneratedYet("format.template", `A '${node.kind}' error format template`, location),
  );

  return { kind: "text", text: "" };
}

function valueShape(type: TypeUse, location: IrLocation, refusals: Refusal[]): SourceValue {
  if (!isKnownVariant("TypeUse", type)) {
    refusals.push(refuseUnknownValueAt(below(location, "kind"), type.kind));

    return { kind: "leaf" };
  }

  switch (type.kind) {
    case "scalar":
    case "enum":
      return { kind: "leaf" };
    case "ref":
      return { kind: "ref", schema: type.schema };
    case "array":
      return { kind: "array", items: valueShape(type.items, below(location, "items"), refusals) };
    default:
      refusals.push(
        refuseNotGeneratedYet(`output.${type.kind}`, `A '${type.kind}' output value`, location),
      );

      return { kind: "leaf" };
  }
}

// Each schema an output may reach: an object keeps its declared members, an enum is a leaf.
function outputShapes(ir: ContractIR, refusals: Refusal[]): SourceValue {
  const shapes: Record<string, SourceValue> = {};

  for (const [schemaId, schema] of Object.entries(ir.schemas)) {
    const location = below(API_LOCATION, "schemas", schemaId);

    if (!isKnownVariant("Schema", schema)) {
      refusals.push(refuseUnknownValueAt(below(location, "kind"), schema.kind));
      continue;
    }

    if (!schema.directions.includes("output")) continue;

    if (schema.kind !== "object") {
      refusals.push(
        refuseNotGeneratedYet("output.schema", `A '${schema.kind}' output schema`, location),
      );
      continue;
    }

    shapes[schemaId] = {
      kind: "object",
      properties: Object.fromEntries(
        schema.properties.map((property, index) => [
          property.name,
          valueShape(property.type, below(location, "properties", String(index), "type"), refusals),
        ]),
      ),
    };
  }

  return shapes;
}

function itemValidator(
  body: TypeUse | undefined,
  validators: ValidatorsDescriptor,
  imports: ModuleImports,
): SourceValue {
  if (body === undefined || !isKnownVariant("TypeUse", body)) return undefined;

  const item = body.kind === "array" ? body.items : body;

  if (!isKnownVariant("TypeUse", item) || item.kind !== "ref") return undefined;

  const ref = Object.hasOwn(validators.schemas, item.schema)
    ? validators.schemas[item.schema]?.output
    : undefined;

  return ref === undefined ? undefined : imports.expression(ref.module, ref.export);
}

// IR values such as a requirement's params are JSON, written as is.
function jsonValue(value: unknown): SourceValue {
  if (value === undefined) return undefined;

  return new SourceExpression(JSON.stringify(value));
}

function sourceOf(value: SourceValue): string {
  if (value instanceof SourceExpression) return value.text;

  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";

  if (Array.isArray(value)) return `[${value.map(sourceOf).join(", ")}]`;

  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .map(([name, member]) => `${JSON.stringify(name)}: ${sourceOf(member)}`);

  return `{ ${members.join(", ")} }`;
}
