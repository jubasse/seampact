import { ARTEFACT_ID_PATTERN } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import type { DescriptorSet, LinkKind } from "./descriptors.js";
import { finishFiles } from "./finish-files.js";
import { DEFAULT_FRAMEWORK_ROUTE_CHECK, DEFAULT_HOOK_BOOT_CHECK } from "./framework-route-check.js";
import { checkGeneratedPaths } from "./generated-paths.js";
import { refuseUnsupportedIr } from "./ir-support-refusal.js";
import { meetsEveryNeed, refuseUnmetLinks } from "./link-check.js";
import { type Refusal, refused } from "./refusal.js";
import type {
  ArtefactDeclaration,
  DescribeOutcome,
  GenerateOutcome,
  GenerateRequest,
  Target,
  TargetDefinition,
} from "./target.js";

// Wraps a target's pure generate into the target the CLI calls. Its `generate` runs, in order and without a way
// to skip one: the IR support check, the options, the link and artefact checks, the target's own generate, the
// path checks, the header and the formatter. Its `describe` runs the IR support check and the options first.
// Artefact declarations the app config could not satisfy throw when the target is defined.
export function defineTarget<
  Options,
  Artefact extends string,
  Consumed extends LinkKind = never,
  Provided extends LinkKind = never,
  Optional extends Consumed = never,
>(definition: TargetDefinition<Options, Artefact, Consumed, Provided, Optional>): Target {
  const { metadata } = definition;

  assertArtefactDeclarations(metadata.packageName, metadata.artefacts);

  async function generate(request: GenerateRequest): Promise<GenerateOutcome> {
    const irRefusals = refuseUnsupportedIr(request.ir, metadata);

    if (irRefusals.length > 0) return refused(irRefusals);

    const parsedOptions = definition.parseOptions(request.options);

    if (parsedOptions.status === "refused") return parsedOptions;

    const { links, artefacts } = request;

    if (
      !meetsEveryNeed<Consumed, Optional>(links, metadata.consumes) ||
      !isDeclaredArtefactSet(artefacts, metadata.artefacts)
    ) {
      return refused([
        ...refuseUnmetLinks(metadata.consumes, links),
        ...refuseUndeclaredArtefacts(artefacts, metadata.artefacts),
      ]);
    }

    const generated = definition.generate({
      ir: request.ir,
      options: parsedOptions.options,
      links,
      artefacts,
      frameworkRoutes: structuredClone(request.frameworkRoutes ?? DEFAULT_FRAMEWORK_ROUTE_CHECK),
      hookCheck: request.hookCheck ?? DEFAULT_HOOK_BOOT_CHECK,
      ...(request.nativeDocsDocument === undefined
        ? {}
        : { nativeDocsDocument: structuredClone(request.nativeDocsDocument) }),
    });

    if (generated.status === "refused") return generated;

    const checked = checkGeneratedPaths(generated.files);

    if (checked.status === "refused") return checked;

    const finished = await finishFiles(
      checked.files,
      {
        packageName: metadata.packageName,
        packageVersion: metadata.packageVersion,
        apiId: request.ir.api.id,
      },
      definition.format,
    );

    if (finished.status === "refused") return finished;

    return {
      status: "generated",
      files: finished.files,
      ...(generated.warnings === undefined ? {} : { warnings: generated.warnings }),
    };
  }

  function describe(ir: ContractIR, rawOptions: unknown): DescribeOutcome<DescriptorSet> {
    const irRefusals = refuseUnsupportedIr(ir, metadata);

    if (irRefusals.length > 0) return refused(irRefusals);

    if (definition.describe === undefined) return { status: "described", descriptors: {} };

    const parsedOptions = definition.parseOptions(rawOptions);

    if (parsedOptions.status === "refused") return parsedOptions;

    return definition.describe(ir, parsedOptions.options);
  }

  return {
    metadata,
    parseOptions: (raw) => definition.parseOptions(raw),
    generate,
    describe,
  };
}

function refuseUndeclaredArtefacts(
  requested: ReadonlySet<string>,
  declared: readonly ArtefactDeclaration[],
): Refusal[] {
  const declaredIds = declared.map((artefact) => artefact.id);

  return [...requested]
    .filter((id) => !declaredIds.includes(id))
    .map((id) => ({
      code: "artefact.unknown",
      message: `The artefact '${id}' is not one this target declares (${declaredIds.join(", ")}).`,
      fix: "Remove it from the target's `artefacts` entry, or use one of the declared ids.",
    }));
}

function isDeclaredArtefactSet<Artefact extends string>(
  requested: ReadonlySet<string>,
  declared: readonly ArtefactDeclaration<Artefact>[],
): requested is ReadonlySet<Artefact> {
  return refuseUndeclaredArtefacts(requested, declared).length === 0;
}

// Ids an app config can switch, unique, each need a declared artefact other than itself, and no artefact on by default that needs one off by
// default, which would refuse every app config that leaves both alone.
function assertArtefactDeclarations(
  packageName: string,
  declared: readonly ArtefactDeclaration[],
): void {
  const problems = declared.flatMap((artefact, index) =>
    artefactDeclarationProblems(artefact, declared.slice(0, index), declared),
  );

  if (problems.length > 0) {
    throw new Error(`${packageName}: invalid artefact declarations: ${problems.join(" ")}`);
  }
}

function artefactDeclarationProblems(
  artefact: ArtefactDeclaration,
  earlier: readonly ArtefactDeclaration[],
  declared: readonly ArtefactDeclaration[],
): string[] {
  const duplicate = earlier.some((other) => other.id === artefact.id)
    ? [`'${artefact.id}' is declared twice.`]
    : [];
  const unswitchable = new RegExp(ARTEFACT_ID_PATTERN).test(artefact.id)
    ? []
    : [`'${artefact.id}' is no id an app config can switch (${ARTEFACT_ID_PATTERN}).`];
  const needProblems = (artefact.needs ?? []).flatMap((need) => {
    const needed = declared.find((other) => other.id === need);

    if (need === artefact.id) return [`'${artefact.id}' needs itself.`];

    if (needed === undefined) return [`'${artefact.id}' needs '${need}', which is not declared.`];

    if (artefact.defaultOn && !needed.defaultOn) {
      return [`'${artefact.id}' is on by default and needs '${need}', which is off by default.`];
    }

    return [];
  });

  return [...unswitchable, ...duplicate, ...needProblems];
}
