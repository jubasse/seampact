import type { ContractIR, IrSupport } from "@seampact/spec/ir";
import type { DescriptorSet, LinkKind, ProvidedDescriptors } from "./descriptors.js";
import type { LinkNeed, LinkOffer, LinkSet, Links } from "./links.js";
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
  consumes: readonly LinkNeed<Consumed>[];
  provides: readonly LinkOffer<Provided>[];
}

export interface GenerateInput<Options, Artefact extends string, Consumed extends LinkKind> {
  ir: ContractIR;
  options: Options;
  links: Links<Consumed>;
  artefacts: ReadonlySet<Artefact>;
}

// One file a target writes. `path` is a POSIX path relative to the target's output root.
export interface GeneratedFile {
  path: string;
  contents: string;
}

export type GenerateOutcome = { status: "generated"; files: readonly GeneratedFile[] } | Refused;

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
> {
  metadata: TargetMetadata<Artefact, Consumed, Provided>;
  format: SourceFormat;
  parseOptions(raw: unknown): ParseOptionsOutcome<Options>;
  generate(input: GenerateInput<Options, Artefact, Consumed>): GenerateOutcome;
}

// A provider must describe what it provides; a target that provides nothing has no `describe`.
type DescribeMember<Options, Provided extends LinkKind> = [Provided] extends [never]
  ? { describe?: never }
  : { describe(ir: ContractIR, options: Options): DescribeOutcome<ProvidedDescriptors<Provided>> };

// What a target package writes: typed by its options, its artefact ids and the link kinds it consumes and provides.
export type TargetDefinition<
  Options,
  Artefact extends string,
  Consumed extends LinkKind = never,
  Provided extends LinkKind = never,
> = TargetDefinitionBase<Options, Artefact, Consumed, Provided> & DescribeMember<Options, Provided>;

// What the CLI passes to any target: raw options, re-parsed by the target, and the links the link check passed.
export interface GenerateRequest {
  ir: ContractIR;
  options: unknown;
  links: LinkSet;
  artefacts: ReadonlySet<string>;
}

// The target as the CLI sees it, whatever its options, artefacts and links.
export interface Target {
  metadata: TargetMetadata;
  parseOptions(raw: unknown): ParseOptionsOutcome<unknown>;
  generate(request: GenerateRequest): Promise<GenerateOutcome>;
  describe(ir: ContractIR, rawOptions: unknown): DescribeOutcome<DescriptorSet>;
}
