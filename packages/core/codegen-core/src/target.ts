import type { ContractIR, IrSupport } from "@seampact/spec/ir";
import type { DescriptorSet, LinkKind, ProvidedDescriptors } from "./descriptors.js";
import type { FrameworkRouteCheck, TunableBootCheck } from "./framework-route-check.js";
import type { GenerateWarning } from "./generate-warning.js";
import type { LinkNeeds, LinkOffers, LinkSet, Links } from "./links.js";
import type { Refused } from "./refusal.js";

// One artefact a target can emit, and whether it is emitted when the app config does not list artefacts.
export interface ArtefactDeclaration<Artefact extends string = string> {
  id: Artefact;
  defaultOn: boolean;
}

// What the CLI reads before it calls the target (ADR 0009): its package, the IR it reads, its artefacts and links.
export interface TargetMetadata<
  Artefact extends string = string,
  Consumed extends LinkKind = LinkKind,
  Provided extends LinkKind = LinkKind,
> {
  packageName: string;
  packageVersion: string;
  irSupport: IrSupport;
  artefacts: readonly ArtefactDeclaration<Artefact>[];
  consumes: LinkNeeds<Consumed>;
  provides: LinkOffers<Provided>;
  /** The boot checks the app config entry may tune; none when absent. */
  bootChecks?: readonly TunableBootCheck[];
}

// The metadata of any target, as the CLI reads it: each kind is present when the target consumes or provides it.
export interface AnyTargetMetadata extends Omit<TargetMetadata, "consumes" | "provides"> {
  consumes: Partial<LinkNeeds>;
  provides: Partial<LinkOffers>;
}

export interface GenerateInput<
  Options,
  Artefact extends string,
  Consumed extends LinkKind,
  Optional extends Consumed = never,
> {
  ir: ContractIR;
  options: Options;
  links: Links<Consumed, Optional>;
  artefacts: ReadonlySet<Artefact>;
  frameworkRoutes: FrameworkRouteCheck;
}

// One file a target writes. `path` is a POSIX path relative to the target's output root.
export interface GeneratedFile {
  path: string;
  contents: string;
}

// `warnings` name the forms the files leave to the developer's code (`GenerateWarning`).
export type GenerateOutcome =
  | {
      status: "generated";
      files: readonly GeneratedFile[];
      warnings?: readonly GenerateWarning[];
    }
  | Refused;

export type ParseOptionsOutcome<Options> = { status: "parsed"; options: Options } | Refused;

export type DescribeOutcome<Descriptors> =
  | { status: "described"; descriptors: Descriptors }
  | Refused;

// The Prettier parsers a target formats its files with (ADR 0015).
export type FormatterParser = "typescript" | "babel" | "json";

// Prettier's `format`, passed by the target so that each target pins its own Prettier version (ADR 0015).
export type SourceFormat = (
  source: string,
  options: { parser: FormatterParser },
) => Promise<string>;

interface TargetDefinitionBase<
  Options,
  Artefact extends string,
  Consumed extends LinkKind,
  Provided extends LinkKind,
  Optional extends Consumed,
> {
  metadata: TargetMetadata<Artefact, Consumed, Provided>;
  format: SourceFormat;
  parseOptions(raw: unknown): ParseOptionsOutcome<Options>;
  generate(input: GenerateInput<Options, Artefact, Consumed, Optional>): GenerateOutcome;
}

// A provider must describe what it provides; a target that provides nothing has no `describe`.
type DescribeMember<Options, Provided extends LinkKind> = [Provided] extends [never]
  ? { describe?: never }
  : { describe(ir: ContractIR, options: Options): DescribeOutcome<ProvidedDescriptors<Provided>> };

// What a target package writes: typed by its options, its artefact ids and the link kinds it consumes and provides,
// and the consumed kinds whose link may be absent.
export type TargetDefinition<
  Options,
  Artefact extends string,
  Consumed extends LinkKind = never,
  Provided extends LinkKind = never,
  Optional extends Consumed = never,
> = TargetDefinitionBase<Options, Artefact, Consumed, Provided, Optional> &
  DescribeMember<Options, Provided>;

// What the CLI passes to any target: raw options, re-parsed by the target, and the links the link check passed.
export interface GenerateRequest {
  ir: ContractIR;
  options: unknown;
  links: LinkSet;
  artefacts: ReadonlySet<string>;
  /** The entry's framework-route check; the default check when absent. */
  frameworkRoutes?: FrameworkRouteCheck;
}

// The target as the CLI sees it, whatever its options, artefacts and links.
export interface Target {
  metadata: AnyTargetMetadata;
  parseOptions(raw: unknown): ParseOptionsOutcome<unknown>;
  generate(request: GenerateRequest): Promise<GenerateOutcome>;
  describe(ir: ContractIR, rawOptions: unknown): DescribeOutcome<DescriptorSet>;
}
