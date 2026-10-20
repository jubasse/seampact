import { readFileSync } from "node:fs";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { type ContractIR, IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { apiIndexSource } from "../api-index.js";
import { defineTarget } from "../define-target.js";
import type { ValidatorStyle, ValidatorsDescriptor } from "../descriptors.js";
import type { TunableBootCheck } from "../framework-route-check.js";
import type { GenerateWarning } from "../generate-warning.js";
import type { Link } from "../links.js";
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

/** The artefact of a target that generates its own validators when its entry gives no `validators` link. */
export const OWN_VALIDATORS_ARTEFACT = "validators";

export type NodeServerArtefact = BoundaryArtefact | typeof OWN_VALIDATORS_ARTEFACT;

/** The boot checks a Node server target generates that its app config entry may tune. */
export const NODE_SERVER_BOOT_CHECKS: readonly TunableBootCheck[] = ["frameworkRoutes"];

/** The validators a target writes itself: files relative to the validators directory, and what they provide. */
export interface OwnValidators {
  readonly files: readonly GeneratedFile[];
  readonly descriptor: ValidatorsDescriptor;
}

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
  /**
   * The validators in the target's own library, written under `validators/` when the entry gives no `validators`
   * link; absent when the target needs the link. Pushes its refusals and returns nothing when it refuses.
   */
  ownValidators?(ir: ContractIR, refusals: Refusal[]): OwnValidators | undefined;
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

const OWN_VALIDATORS_DIRECTORY = "validators";
const MODULE_EXTENSION = ".ts";
const ROUTES_MODULE = "routes";
const HANDLERS_MODULE = "handlers";
const HOOKS_MODULE = "hooks";
const INDEX_MODULE = "index";
const DEFAULT_RUNTIME_PROFILE: ServerRuntimeProfile = "node";

/**
 * A Node server target, as the CLI loads it. It reads the operation types through the `types` link and the input
 * validators through the `validators` link, which is optional when the placement writes its own validators, and
 * provides nothing.
 */
export function nodeServerTarget(targetPackage: NodeServerTargetPackage): Target {
  const ownLibrary = ownValidatorsLibrary(targetPackage);

  return defineTarget<
    NodeServerOptions,
    NodeServerArtefact,
    "types" | "validators",
    never,
    "validators"
  >({
    metadata: {
      packageName: targetPackage.packageName,
      packageVersion: targetPackage.packageVersion,
      irSupport: {
        irVersions: [IR_VERSION],
        irRevision: IR_REVISION,
        kinds: ["httpOperation"],
        features: [],
      },
      artefacts: [
        { id: BOUNDARY_ARTEFACT, defaultOn: true },
        ...(ownLibrary === undefined
          ? []
          : [{ id: OWN_VALIDATORS_ARTEFACT, defaultOn: true } as const]),
      ],
      bootChecks: NODE_SERVER_BOOT_CHECKS,
      consumes: {
        types: { styles: ["typescript"] },
        validators: {
          styles: [...targetPackage.validatorStyles],
          ...(ownLibrary === undefined ? {} : { optional: { ownLibrary } }),
        },
      },
      provides: {},
    },
    format: targetPackage.format,
    parseOptions: parseNodeServerOptions,
    generate: (input) => nodeServerBoundaryFiles(input, targetPackage.placement),
  });
}

// The library of the target's own validators, read from the compatibility matrix; none when the placement writes
// none.
function ownValidatorsLibrary(targetPackage: NodeServerTargetPackage): string | undefined {
  if (targetPackage.placement.ownValidators === undefined) return undefined;

  const [ownValidator] = serverTargetCompatibility(targetPackage.packageName).ownValidators;

  if (ownValidator === undefined) {
    throw new Error(
      `${targetPackage.packageName} writes its own validators, and the compatibility matrix records none for it.`,
    );
  }

  return ownValidator.library;
}

// Every module of one api's boundary, or every refusal at once (A47). With no `validators` link, the own
// validators of the placement are written and read instead, when the `validators` artefact is on.
export function nodeServerBoundaryFiles(
  input: GenerateInput<NodeServerOptions, NodeServerArtefact, "types" | "validators", "validators">,
  placement: NodeServerPlacement,
): GenerateOutcome {
  const boundaryOn = input.artefacts.has(BOUNDARY_ARTEFACT);
  const ownValidatorsOn = input.artefacts.has(OWN_VALIDATORS_ARTEFACT);
  const givenLink = input.links.validators;

  if (givenLink === undefined && boundaryOn && !ownValidatorsOn) {
    return { status: "refused", refusals: [validatorsArtefactNeeded()] };
  }

  const own =
    givenLink === undefined && ownValidatorsOn
      ? writeOwnValidators(input.ir, placement)
      : undefined;

  if (own?.status === "refused") return own;

  const ownFiles = own === undefined ? [] : own.files;

  const ignoredArtefactWarnings =
    givenLink !== undefined && ownValidatorsOn ? [ignoredValidatorsArtefact()] : [];

  if (!boundaryOn) {
    return { status: "generated", files: ownFiles, warnings: ignoredArtefactWarnings };
  }

  const validators = givenLink ?? own?.link;

  if (validators === undefined) {
    throw new Error(
      "A node server target without a validators link must write its own validators.",
    );
  }

  const boundary = boundaryFiles(input, placement, validators);

  if (boundary.status === "refused") return boundary;

  return {
    ...boundary,
    files: [...ownFiles, ...boundary.files],
    warnings: [...(boundary.warnings ?? []), ...ignoredArtefactWarnings],
  };
}

function ignoredValidatorsArtefact(): GenerateWarning {
  return {
    code: "validators.artefact.ignored",
    message: `The '${OWN_VALIDATORS_ARTEFACT}' artefact is listed and a validators link is given: the linked validators are used and none are written.`,
    fix: `Drop '${OWN_VALIDATORS_ARTEFACT}' from the artefacts, or drop the validators link to write the target's own validators.`,
  };
}

function validatorsArtefactNeeded(): Refusal {
  return {
    code: "artefact.validators.needed",
    message:
      "The boundary needs validators, and the entry gives no `validators` link and turns the `validators` artefact off.",
    fix: "Link a validators provider in the target's `link` entry, or add `validators` to its `artefacts`.",
  };
}

type OwnValidatorsOutcome =
  | { status: "written"; files: GeneratedFile[]; link: Link<"validators"> }
  | { status: "refused"; refusals: Refusal[] };

function writeOwnValidators(ir: ContractIR, placement: NodeServerPlacement): OwnValidatorsOutcome {
  const refusals: Refusal[] = [];
  const own = placement.ownValidators?.(ir, refusals);

  if (own === undefined || refusals.length > 0) {
    return { status: "refused", refusals: withoutRepeats(refusals) };
  }

  return {
    status: "written",
    files: own.files.map((file) => ({
      path: `${OWN_VALIDATORS_DIRECTORY}/${file.path}`,
      contents: file.contents,
    })),
    link: {
      descriptor: own.descriptor,
      location: { kind: "relative", path: OWN_VALIDATORS_DIRECTORY },
    },
  };
}

function boundaryFiles(
  input: GenerateInput<NodeServerOptions, NodeServerArtefact, "types" | "validators", "validators">,
  placement: NodeServerPlacement,
  validators: Link<"validators">,
): GenerateOutcome {
  const { ir, links, options } = input;
  const refusals: Refusal[] = [];
  const warnings: GenerateWarning[] = [];
  const runtimeProfile = placement.runtimeProfile ?? DEFAULT_RUNTIME_PROFILE;
  const runtimeDirectory = SERVER_RUNTIME_DIRECTORIES[runtimeProfile];
  const routes = routeTableSource(
    ir,
    validators,
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
