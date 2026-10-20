import {
  below,
  ExportNames,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
} from "@seampact/codegen-core";
import {
  handlerInterfaceName,
  type NodeServerOptions,
  operationIdentifier,
  responseSettingsOf,
} from "@seampact/codegen-core/node-server";
import type { ContractIR, Operation, TypeUse } from "@seampact/spec/ir";

// The `adonis` module of one api: the boundary built from its route table, the fixed exports of ADR 0019 "Target
// options and names", and the input accessor of each operation, named by the operation.

const ADONIS_MODULE = "adonis";

// The fixed exports; an operation of the same name takes the reserved-name suffix (ADR 0007 section 5).
const FIXED_EXPORTS = [
  "registerRoutes",
  "renderPreRoutingError",
  "renderContractError",
  "LARGEST_BODY_LIMIT",
  "ROUTE_NAMES_BY_ACCESS",
] as const;

// The module's own local names, which an operation accessor must not shadow either.
const LOCAL_NAMES = [
  "boundary",
  "createAdonisBoundary",
  "routeNamesByAccess",
  "CONTRACT_API",
  "OPERATIONS",
  "SeampactHooks",
  "Handlers",
  "LazyController",
  "Controllers",
  "OperationName",
] as const;

const RESERVED_SUFFIX = "_";
const NO_BODY_LIMIT = 0;
const PATH_PARAM = /^\{[^}]+\}$/;
// A JSON body the bodyparser's strict mode accepts: an object or an array at the top level.
const STRICT_BODY_SCHEMAS: readonly string[] = ["object", "map"];

interface OperationEntry {
  readonly id: string;
  readonly operation: string;
  readonly endpoints: string;
}

export function adonisModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  const names = new ExportNames(ADONIS_MODULE);
  const reserved: readonly string[] = [...FIXED_EXPORTS, ...LOCAL_NAMES];
  const entries: OperationEntry[] = ir.operations.map((operation) => ({
    id: operation.id,
    operation: operationIdentifier(operation),
    endpoints: handlerInterfaceName(ir, operation),
  }));

  ir.operations.forEach((operation, index) => {
    refusals.push(...adonisRefusals(ir, operation, index));
  });

  const accessors = entries.map((entry, index) => {
    const name = reserved.includes(entry.operation)
      ? `${entry.operation}${RESERVED_SUFFIX}`
      : entry.operation;

    names.claim(name, operationLocation(index, entry.id), refusals);

    return `/** The validated input of '${entry.id}': \`${name}.input(ctx)\`. */\nexport const ${name} = boundary.operation<Parameters<Handlers.${entry.endpoints}[${JSON.stringify(entry.operation)}]>[0]>(${JSON.stringify(entry.id)});`;
  });
  const endpoints = [...new Set(entries.map((entry) => entry.endpoints))];
  const largestBodyLimit = Math.max(
    NO_BODY_LIMIT,
    ...ir.operations.map((operation) => operation.input?.bodyLimitBytes ?? NO_BODY_LIMIT),
  );

  return [
    'import { createAdonisBoundary, type LazyController, routeNamesByAccess } from "./adonis-boundary.js";',
    'import type * as Handlers from "./handlers.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    "",
    "/** The controller of each handler interface, as a lazy import of its module. */",
    "interface Controllers {",
    ...endpoints.map((name) => `  readonly ${name}: LazyController<Handlers.${name}>;`),
    "}",
    "",
    `type OperationName = ${entries.map((entry) => JSON.stringify(entry.operation)).join(" | ")};`,
    "",
    `const OPERATIONS = ${JSON.stringify(entries)} as const;`,
    "",
    `const boundary = createAdonisBoundary<SeampactHooks, Controllers, OperationName>(CONTRACT_API, ${JSON.stringify(responseSettingsOf(options))}, OPERATIONS);`,
    "",
    "/** Adds the api's routes to the router and runs the boot check; call it from start/routes.ts. */",
    "export const registerRoutes = boundary.registerRoutes;",
    "/** Renders, on a contract path, a refusal raised before the boundary; false when it does nothing. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** Writes a contract error in the api's format from the app's exception handler; false off a contract route. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** The largest route body limit; the bodyparser's json.limit must be at least this. */",
    `export const LARGEST_BODY_LIMIT = ${largestBodyLimit};`,
    "/** The route names per access kind, for app middleware that skips public or optional routes. */",
    "export const ROUTE_NAMES_BY_ACCESS = routeNamesByAccess(CONTRACT_API, OPERATIONS);",
    "",
    accessors.join("\n\n"),
    "",
  ].join("\n");
}

// The forms this placement cannot serve yet (ADR 0019 "Refused by name or waiting").
function adonisRefusals(ir: ContractIR, operation: Operation, index: number): Refusal[] {
  const location = operationLocation(index, operation.id);
  const refusals: Refusal[] = [];

  if (operation.path.split("/").some((segment) => isMixedSegment(segment))) {
    refusals.push(
      refuseNotGeneratedYet(
        "path.segment.mixed",
        "A path segment that mixes a placeholder with literal text, such as '{id}:archive',",
        below(location, "path"),
      ),
    );
  }

  const body = operation.input?.schema;

  if (body !== undefined && !isStrictJsonBody(ir, body)) {
    refusals.push(
      refuseNotGeneratedYet(
        "input.body.topLevel",
        "A request body schema other than a plain object, map or array (a union or an alias of an object included),",
        below(location, "input", "schema"),
      ),
    );
  }

  return refusals;
}

function isMixedSegment(segment: string): boolean {
  return segment.includes("{") && !PATH_PARAM.test(segment);
}

function isStrictJsonBody(ir: ContractIR, body: TypeUse): boolean {
  if (body.kind === "array") return true;

  if (body.kind !== "ref" || !("schema" in body) || typeof body.schema !== "string") return false;

  const schema = Object.hasOwn(ir.schemas, body.schema) ? ir.schemas[body.schema] : undefined;

  return schema !== undefined && STRICT_BODY_SCHEMAS.includes(schema.kind);
}
