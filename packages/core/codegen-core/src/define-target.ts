import type { ContractIR } from "@seampact/spec/ir";
import type { DescriptorSet, LinkKind } from "./descriptors.js";
import { finishFiles } from "./finish-files.js";
import { DEFAULT_FRAMEWORK_ROUTE_CHECK } from "./framework-route-check.js";
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
export function defineTarget<
  Options,
  Artefact extends string,
  Consumed extends LinkKind = never,
  Provided extends LinkKind = never,
>(definition: TargetDefinition<Options, Artefact, Consumed, Provided>): Target {
  const { metadata } = definition;

  async function generate(request: GenerateRequest): Promise<GenerateOutcome> {
    const irRefusals = refuseUnsupportedIr(request.ir, metadata);

    if (irRefusals.length > 0) return refused(irRefusals);

    const parsedOptions = definition.parseOptions(request.options);

    if (parsedOptions.status === "refused") return parsedOptions;

    const { links, artefacts } = request;

    if (
      !meetsEveryNeed(links, metadata.consumes) ||
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
