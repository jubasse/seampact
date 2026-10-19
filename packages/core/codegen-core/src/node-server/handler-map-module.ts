import type { ContractIR } from "@seampact/spec/ir";
import { operationLocation } from "../ir-location.js";
import { ExportNames } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import type { NodeServerOptions } from "./options.js";
import { SERVER_RUNTIME_DIRECTORIES, type ServerRuntimeProfile } from "./runtime-files.js";
import { handlerInterfaceName, operationIdentifier } from "./server-types.js";

// The declarations a handler-map framework module (Express, Fastify, Hono) starts with: the handler objects keyed by
// interface name, the operation names an override takes, each operation's binding, and the target options.

const NO_BODY_LIMIT = 0;

/** The module's imports and local declarations: `ContractHandlers`, `OperationName`, `HANDLER_BINDINGS`, `GENERATED_SETTINGS`. */
export function handlerMapDeclarations(
  ir: ContractIR,
  options: NodeServerOptions,
  frameworkModule: string,
  refusals: Refusal[],
  runtimeProfile: ServerRuntimeProfile = "node",
): string[] {
  const overrideNames = new ExportNames(`${frameworkModule} operations`);
  const interfaces = new Set<string>();
  const bindings = ir.operations.map((operation, index) => {
    const handlers = handlerInterfaceName(ir, operation);
    const method = operationIdentifier(operation);

    overrideNames.claim(method, operationLocation(index, operation.id), refusals);
    interfaces.add(handlers);

    return `  ${JSON.stringify(operation.id)}: { handlers: ${JSON.stringify(handlers)}, method: ${JSON.stringify(method)} },`;
  });
  const operationNames = ir.operations.map((operation) =>
    JSON.stringify(operationIdentifier(operation)),
  );

  return [
    `import type { HandlerBindings, ResponseSettings } from "./${SERVER_RUNTIME_DIRECTORIES[runtimeProfile]}/handler-map.js";`,
    'import type * as Handlers from "./handlers.js";',
    "",
    "/** The handler objects of the api, keyed by their interface's name. */",
    "interface ContractHandlers {",
    ...[...interfaces].map((name) => `  readonly ${name}: Handlers.${name};`),
    "}",
    "",
    "/** The operations an override in `operations` names. */",
    `type OperationName = ${operationNames.length === 0 ? "never" : operationNames.join(" | ")};`,
    "",
    "const HANDLER_BINDINGS: HandlerBindings = {",
    ...bindings,
    "};",
    "",
    `const GENERATED_SETTINGS: ResponseSettings = ${JSON.stringify(options)};`,
  ];
}

/** The largest route body limit of the api, 0 when no operation takes a body. */
export function largestBodyLimit(ir: ContractIR): number {
  return Math.max(
    NO_BODY_LIMIT,
    ...ir.operations.map((operation) => operation.input?.bodyLimitBytes ?? NO_BODY_LIMIT),
  );
}
