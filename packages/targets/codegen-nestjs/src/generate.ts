import { readFileSync } from "node:fs";
import {
  apiIndexSource,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type GenerateWarning,
  type Refusal,
} from "@seampact/codegen-core";
import {
  handlersSource,
  hookTypesSource,
  NODE_SERVER_RUNTIME_DIRECTORY,
  nodeServerRuntimeFiles,
  routeTableSource,
} from "@seampact/codegen-core/node-server";
import { nestjsModuleSource } from "./nestjs-module.js";
import type { NestjsOptions } from "./options.js";

export const BOUNDARY_ARTEFACT = "boundary";

export type BoundaryArtefact = typeof BOUNDARY_ARTEFACT;

const MODULE_EXTENSION = ".ts";
const ROUTES_MODULE = "routes";
const HANDLERS_MODULE = "handlers";
const HOOKS_MODULE = "hooks";
const NESTJS_MODULE = "nestjs";
const BOUNDARY_RUNTIME_MODULE = "nestjs-boundary";
const INDEX_MODULE = "index";

// The NestJS placement, a checked source of this package one directory above both `src` and `dist`.
const BOUNDARY_RUNTIME_URL = new URL("../runtime/nestjs-boundary.ts", import.meta.url);

// Every module of one api's boundary, or every refusal at once (A47).
export function generateBoundary(
  input: GenerateInput<NestjsOptions, BoundaryArtefact, "types" | "validators">,
): GenerateOutcome {
  if (!input.artefacts.has(BOUNDARY_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const refusals: Refusal[] = [];
  const warnings: GenerateWarning[] = [];
  const routes = routeTableSource(
    ir,
    links.validators,
    `${ROUTES_MODULE}${MODULE_EXTENSION}`,
    {
      runtimeModule: `./${NODE_SERVER_RUNTIME_DIRECTORY}/contract-route.js`,
      withItemValidators: options.bodyValidation,
    },
    refusals,
    warnings,
  );
  const handlers = handlersSource(
    ir,
    links.types,
    `${HANDLERS_MODULE}${MODULE_EXTENSION}`,
    refusals,
  );
  const hooks = hookTypesSource(
    ir,
    links.types,
    `${HOOKS_MODULE}${MODULE_EXTENSION}`,
    `./${NODE_SERVER_RUNTIME_DIRECTORY}/boundary-hooks.js`,
    refusals,
  );
  const nestjs = nestjsModuleSource(ir, options, refusals);

  if (refusals.length > 0) return { status: "refused", refusals: withoutRepeats(refusals) };

  const files: GeneratedFile[] = [
    ...nodeServerRuntimeFiles(),
    {
      path: `${BOUNDARY_RUNTIME_MODULE}${MODULE_EXTENSION}`,
      contents: readFileSync(BOUNDARY_RUNTIME_URL, "utf8"),
    },
    { path: `${ROUTES_MODULE}${MODULE_EXTENSION}`, contents: routes },
    { path: `${HANDLERS_MODULE}${MODULE_EXTENSION}`, contents: handlers },
    { path: `${HOOKS_MODULE}${MODULE_EXTENSION}`, contents: hooks },
    { path: `${NESTJS_MODULE}${MODULE_EXTENSION}`, contents: nestjs },
    {
      path: `${INDEX_MODULE}${MODULE_EXTENSION}`,
      contents: apiIndexSource([
        { module: NESTJS_MODULE },
        { module: HANDLERS_MODULE },
        { module: HOOKS_MODULE },
      ]),
    },
  ];

  return { status: "generated", files, warnings };
}

// A form shared by several operations is refused once.
function withoutRepeats(refusals: readonly Refusal[]): Refusal[] {
  const seen = new Set<string>();

  return refusals.filter((refusal) => {
    const key = JSON.stringify([refusal.code, refusal.member, refusal.operation]);

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}
