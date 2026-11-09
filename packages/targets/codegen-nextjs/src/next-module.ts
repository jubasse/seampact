import type { ImportSpecifierStyle, Refusal } from "@seampact/codegen-core";
import { relativeModuleSpecifier } from "@seampact/codegen-core";
import {
  handlerMapDeclarations,
  literalSegmentRefusals,
  mixedSegmentRefusals,
  type NodeServerOptions,
  SERVER_RUNTIME_PACKAGE,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `next` module of one api: the route handler built from its route table and handler bindings, and the fixed
// exports of ADR 0030 "Placement", over the Next.js placement of `@seampact/server-runtime`. No export is named by an
// operation. Its relative imports are extensionless, since Turbopack does not map a `.js` specifier to its `.ts`.

export const NEXT_MODULE = "next";

export const NEXT_IMPORT_SPECIFIERS: ImportSpecifierStyle = "extensionless";

const HOOKS_MODULE = "hooks";
const ROUTES_MODULE = "routes";

export function nextModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  refusals.push(...literalSegmentRefusals(ir), ...mixedSegmentRefusals(ir));

  const hooksSpecifier = relativeModuleSpecifier(NEXT_MODULE, HOOKS_MODULE, NEXT_IMPORT_SPECIFIERS);
  const routesSpecifier = relativeModuleSpecifier(
    NEXT_MODULE,
    ROUTES_MODULE,
    NEXT_IMPORT_SPECIFIERS,
  );

  return [
    `import { createNextBoundary } from "${SERVER_RUNTIME_PACKAGE}/next";`,
    `import type { SeampactHooks } from "${hooksSpecifier}";`,
    `import { CONTRACT_API, type InputRules } from "${routesSpecifier}";`,
    ...handlerMapDeclarations(ir, options, NEXT_MODULE, refusals, NEXT_IMPORT_SPECIFIERS),
    "",
    `export { MAX_CHECKED_ERROR_BODY_BYTES, MAX_RENDERED_ISSUES } from "${SERVER_RUNTIME_PACKAGE}";`,
    "",
    "const boundary = createNextBoundary<SeampactHooks, ContractHandlers, OperationName, InputRules>(CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** The route handler of the api's catch-all `route.ts`, exported there under every method name: `routeHandler({ handlers, hooks })`, where `handlers` holds one object per handler interface, keyed by its name (`{ NotesEndpoints: { ... } }`); runs the boot check. */",
    "export const routeHandler = boundary.routeHandler;",
    "/** The reply of a contract error in the api's format, for the app's own Node.js routes or its `proxy.ts`. */",
    "export const renderContractError = boundary.renderContractError;",
    "",
  ].join("\n");
}
