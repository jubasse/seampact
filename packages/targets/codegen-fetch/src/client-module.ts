import type { OperationTypeExports } from "@seampact/codegen-core";
import { type ExportRef, importSpecifier, type Link, propertyKey } from "@seampact/codegen-core";
import type { PlannedOperation } from "./operation-plan.js";
import type { ErrorStyle } from "./options.js";

export const CLIENT_MODULE = "client";
export const RUNTIME_MODULE = "runtime";
export const INDEX_MODULE = "index";
export const MODULE_EXTENSION = ".ts";

const MODULE_SUFFIX = ".js";
const NAMESPACE_SUFFIX = "Types";

// One operation as the client module writes it: its method name, plan and the types link exports it reads.
export interface ClientOperation {
  id: string;
  methodName: string;
  method: string;
  path: string;
  planned: PlannedOperation;
  types: OperationTypeExports;
}

// The client module: a plan per operation, the `Client` interface typed from the types link, and `createClient`.
export function clientModuleSource(
  operations: readonly ClientOperation[],
  typesLink: Link<"types">,
  errorStyle: ErrorStyle,
): string {
  const clientFile = `${CLIENT_MODULE}${MODULE_EXTENSION}`;
  const namespaces = typeNamespaces(operations);
  const typeOf = (exportRef: ExportRef) =>
    `${typeNamespaceName(exportRef.module)}.${exportRef.export}`;
  const importLines = [...namespaces].map(
    (module) =>
      `import type * as ${typeNamespaceName(module)} from "${importSpecifier(typesLink, { module, export: "" }, clientFile)}";`,
  );

  const body = [
    plansSource(operations),
    clientInterfaceSource(operations, typeOf, errorStyle),
    ...(errorStyle === "throw" ? [contractErrorSource(operations, typeOf)] : []),
    createClientSource(operations, errorStyle),
  ].join("\n\n");

  return [[...importLines, runtimeImport(body)].join("\n"), body].join("\n\n");
}

function typeNamespaces(operations: readonly ClientOperation[]): Set<string> {
  const modules = operations.flatMap(({ types }) => [
    types.input.module,
    types.output.module,
    types.errors.module,
  ]);

  return new Set([...modules].sort());
}

// `operations/input` is imported as `operationsInputTypes`; a module path is letters, digits, `-`, `_` and `/`.
export function typeNamespaceName(module: string): string {
  const words = module.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  const camel = words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");

  return `${camel}${NAMESPACE_SUFFIX}`;
}

// Imports the runtime names the module body uses, so the module has no unused import.
function runtimeImport(body: string): string {
  const isUsed = (name: string) => new RegExp(`\\b${name}\\b`).test(body);
  const values = RUNTIME_VALUES.filter(isUsed);
  const types = RUNTIME_TYPES.filter(isUsed).map((name) => `type ${name}`);

  return `import { ${[...values, ...types].join(", ")} } from "./${RUNTIME_MODULE}${MODULE_SUFFIX}";`;
}

const RUNTIME_VALUES: readonly string[] = [
  "callOperation",
  "callOperationOrThrow",
  "checkClientConfig",
  "ContractError",
];
const RUNTIME_TYPES: readonly string[] = [
  "CallArguments",
  "CallOptions",
  "CallResult",
  "ClientConfig",
  "ClientInput",
  "ErrorResult",
  "NotModifiedResult",
  "OperationPlan",
  "PagedOutput",
  "ReplayFlag",
  "SuccessResult",
  "TimedCallArguments",
  "UnexpectedResult",
];

function plansSource(operations: readonly ClientOperation[]): string {
  const members = operations.map(
    ({ methodName, planned }) => `${propertyKey(methodName)}: ${JSON.stringify(planned.plan)},`,
  );

  return `const plans = {\n${members.join("\n")}\n} satisfies Record<string, OperationPlan>;`;
}

function clientInterfaceSource(
  operations: readonly ClientOperation[],
  typeOf: (exportRef: ExportRef) => string,
  errorStyle: ErrorStyle,
): string {
  const members = operations.map((operation) => {
    const { methodName, planned, types } = operation;
    const success = successType(operation, typeOf);
    const result =
      errorStyle === "throw" ? success : `CallResult<${success}, ${typeOf(types.errors)}>`;

    return `/** \`${escapeJsdoc(`${operation.method.toUpperCase()} ${operation.path}`)}\` */\n${propertyKey(methodName)}(...args: ${argumentsType(planned, typeOf(types.input))}): Promise<${result}>;`;
  });
  const thrown =
    errorStyle === "throw"
      ? " A declared error or an unexpected answer is thrown as a `ClientContractError`."
      : "";

  return `/** One method per operation.${thrown} A network failure, a timeout or an abort rejects. */\nexport interface Client {\n${members.join("\n\n")}\n}`;
}

// `*/` inside a path would end the generated comment.
function escapeJsdoc(text: string): string {
  return text.replaceAll("*/", "*\\/");
}

function successType(operation: ClientOperation, typeOf: (exportRef: ExportRef) => string): string {
  const { plan } = operation.planned;
  const extra = plan.idempotency === undefined ? "{}" : "ReplayFlag";
  const success = `SuccessResult<${outputType(operation, typeOf)}, ${extra}>`;

  return plan.notModified ? `${success} | NotModifiedResult` : success;
}

// A page's handler output, its body replaced by the items and the facts the client reads.
function outputType(operation: ClientOperation, typeOf: (exportRef: ExportRef) => string): string {
  const output = typeOf(operation.types.output);
  const pages = operation.planned.plan.successes.flatMap((success) =>
    success.shape === "page" ? [success] : [],
  );
  const [firstPage] = pages;

  if (firstPage === undefined) return output;

  const statuses = pages.map((page) => String(page.status)).join(" | ");
  const facts = firstPage.facts.map(
    (fact) => `${propertyKey(fact.role)}${fact.required ? "" : "?"}: ${FACT_TYPES[fact.value]};`,
  );

  return `PagedOutput<${output}, ${statuses}, {\n${facts.join("\n")}\n}>`;
}

const FACT_TYPES = { number: "number", text: "string", boolean: "boolean" } as const;

function argumentsType(planned: PlannedOperation, inputType: string): string {
  const filled = planned.filledHeaderKeys.map((key) => JSON.stringify(key)).join(" | ");
  const input = `ClientInput<${inputType}, ${filled === "" ? "never" : filled}>`;

  return planned.needsTimeout
    ? `TimedCallArguments<${input}>`
    : `CallArguments<${input}, CallOptions>`;
}

function contractErrorSource(
  operations: readonly ClientOperation[],
  typeOf: (exportRef: ExportRef) => string,
): string {
  const variants = operations.map(
    ({ id, types }) =>
      `ContractError<${JSON.stringify(id)}, ErrorResult<${typeOf(types.errors)}> | UnexpectedResult>`,
  );

  return [
    `/** What a method throws: narrow on \`operation\` to read the declared errors of that operation. */\nexport type ClientContractError = ${variants.length === 0 ? "never" : variants.join(" | ")};`,
    `export function isClientContractError(error: unknown): error is ClientContractError {\nreturn error instanceof ContractError;\n}`,
  ].join("\n\n");
}

function createClientSource(
  operations: readonly ClientOperation[],
  errorStyle: ErrorStyle,
): string {
  const members = operations.map(({ id, methodName }) => {
    const plan = `plans[${JSON.stringify(methodName)}]`;
    const call =
      errorStyle === "throw"
        ? `callOperationOrThrow(${JSON.stringify(id)}, config, ${plan}, ...args)`
        : `callOperation(config, ${plan}, ...args)`;

    return `${propertyKey(methodName)}: (...args) => ${call},`;
  });

  return `/** The client of every operation, sending to \`config.baseUrl\` with the platform fetch unless \`config.fetch\` is given. */\nexport function createClient(config: ClientConfig): Client {\ncheckClientConfig(config, plans);\n\nreturn {\n${members.join("\n")}\n};\n}`;
}
