import { readFileSync } from "node:fs";
import { type ContractIR, IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { apiIndexSource } from "../api-index.js";
import { defineTarget } from "../define-target.js";
import type { ValidatorStyle } from "../descriptors.js";
import type { GenerateWarning } from "../generate-warning.js";
import { type Refusal, withoutRepeats } from "../refusal.js";
import type {
  GeneratedFile,
  GenerateInput,
  GenerateOutcome,
  SourceFormat,
  Target,
} from "../target.js";
import { type NodeServerOptions, parseNodeServerOptions } from "./options.js";
import { routeTableSource } from "./route-table.js";
import {
  nodeServerRuntimeFiles,
  SERVER_RUNTIME_DIRECTORIES,
  type ServerRuntimeProfile,
} from "./runtime-files.js";
import { handlersSource, hookTypesSource } from "./server-types.js";

// The files of one api's Node server boundary: the shared runtime, the target's placement file, the route table,
// handler interfaces and hook types, the target's framework module, and the api index.

export const BOUNDARY_ARTEFACT = "boundary";

export type BoundaryArtefact = typeof BOUNDARY_ARTEFACT;

/** What a Node server target adds to the shared files. */
export interface NodeServerPlacement {
  /** The module name of the static placement file, such as `nestjs-boundary`. */
  readonly runtimeModule: string;
  /** The placement file, a checked source of the target package copied as is. */
  readonly runtimeSourceUrl: URL;
  /** The module name of the api's framework module, such as `nestjs`, re-exported by the index first. */
  readonly frameworkModule: string;
  frameworkSource(ir: ContractIR, options: NodeServerOptions, refusals: Refusal[]): string;
  /** The shared runtime the placement imports: `node` (the default) or `web` for a Web-standard placement. */
  readonly runtimeProfile?: ServerRuntimeProfile;
}

/** A Node server target package: its name and version, its Prettier and its placement. */
export interface NodeServerTargetPackage {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly format: SourceFormat;
  readonly placement: NodeServerPlacement;
  /** The validator styles the target reads through its `validators` link. */
  readonly validatorStyles: readonly ValidatorStyle[];
}

const MODULE_EXTENSION = ".ts";
const ROUTES_MODULE = "routes";
const HANDLERS_MODULE = "handlers";
const HOOKS_MODULE = "hooks";
const INDEX_MODULE = "index";
const DEFAULT_RUNTIME_PROFILE: ServerRuntimeProfile = "node";

/**
 * A Node server target, as the CLI loads it. It reads the operation types through the `types` link and the input
 * validators through the `validators` link, and provides nothing.
 */
export function nodeServerTarget(targetPackage: NodeServerTargetPackage): Target {
  return defineTarget<NodeServerOptions, BoundaryArtefact, "types" | "validators">({
    metadata: {
      packageName: targetPackage.packageName,
      packageVersion: targetPackage.packageVersion,
      irSupport: {
        irVersions: [IR_VERSION],
        irRevision: IR_REVISION,
        kinds: ["httpOperation"],
        features: [],
      },
      artefacts: [{ id: BOUNDARY_ARTEFACT, defaultOn: true }],
      bootChecks: ["frameworkRoutes"],
      consumes: {
        types: { styles: ["typescript"] },
        validators: { styles: [...targetPackage.validatorStyles] },
      },
      provides: {},
    },
    format: targetPackage.format,
    parseOptions: parseNodeServerOptions,
    generate: (input) => nodeServerBoundaryFiles(input, targetPackage.placement),
  });
}

// Every module of one api's boundary, or every refusal at once (A47).
export function nodeServerBoundaryFiles(
  input: GenerateInput<NodeServerOptions, BoundaryArtefact, "types" | "validators">,
  placement: NodeServerPlacement,
): GenerateOutcome {
  if (!input.artefacts.has(BOUNDARY_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const refusals: Refusal[] = [];
  const warnings: GenerateWarning[] = [];
  const runtimeProfile = placement.runtimeProfile ?? DEFAULT_RUNTIME_PROFILE;
  const runtimeDirectory = SERVER_RUNTIME_DIRECTORIES[runtimeProfile];
  const routes = routeTableSource(
    ir,
    links.validators,
    moduleFile(ROUTES_MODULE),
    {
      runtimeModule: `./${runtimeDirectory}/contract-route.js`,
      withItemValidators: options.bodyValidation,
      frameworkRoutes: input.frameworkRoutes,
    },
    refusals,
    warnings,
  );
  const handlers = handlersSource(ir, links.types, moduleFile(HANDLERS_MODULE), refusals);
  const hooks = hookTypesSource(
    ir,
    links.types,
    moduleFile(HOOKS_MODULE),
    `./${runtimeDirectory}/boundary-hooks.js`,
    refusals,
  );
  const framework = placement.frameworkSource(ir, options, refusals);

  if (refusals.length > 0) return { status: "refused", refusals: withoutRepeats(refusals) };

  const files: GeneratedFile[] = [
    ...nodeServerRuntimeFiles(runtimeProfile),
    {
      path: moduleFile(placement.runtimeModule),
      contents: readFileSync(placement.runtimeSourceUrl, "utf8"),
    },
    { path: moduleFile(ROUTES_MODULE), contents: routes },
    { path: moduleFile(HANDLERS_MODULE), contents: handlers },
    { path: moduleFile(HOOKS_MODULE), contents: hooks },
    { path: moduleFile(placement.frameworkModule), contents: framework },
    {
      path: moduleFile(INDEX_MODULE),
      contents: apiIndexSource([
        { module: placement.frameworkModule },
        { module: HANDLERS_MODULE },
        { module: HOOKS_MODULE },
      ]),
    },
  ];

  return { status: "generated", files, warnings };
}

function moduleFile(module: string): string {
  return `${module}${MODULE_EXTENSION}`;
}
