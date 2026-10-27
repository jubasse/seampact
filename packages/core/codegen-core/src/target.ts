import type { ContractIR, IrSupport } from "@seampact/spec/ir";
import type { DescriptorSet, LinkKind, ProvidedDescriptors } from "./descriptors.js";
import type {
  FrameworkRouteCheck,
  HookBootCheck,
  TunableBootCheck,
} from "./framework-route-check.js";
import type { GenerateWarning } from "./generate-warning.js";
import type { LinkNeeds, LinkOffers, LinkSet, Links } from "./links.js";
import type { NativeDocsDocument } from "./native-docs-document.js";
import type { Refused } from "./refusal.js";

// One artefact a target can emit, whether it is emitted when the app config does not switch it, and the artefacts
// it cannot be emitted without (the app config cannot switch those off while it is on). With `leftOffWithoutNeeds`,
// an artefact the app config does not write is left off, not refused, when a need is off.
export interface ArtefactDeclaration<Artefact extends string = string> {
  id: Artefact;
  defaultOn: boolean;
  needs?: readonly Artefact[];
  leftOffWithoutNeeds?: boolean;
}

// What a target generates for an app: a server serves the contract's routes, a client calls them, a provider gives
// other targets descriptors through links (types, validators). The app's default OpenAPI documents and the merged
// documents' contributions follow the server targets (A43).
export const TARGET_ROLES = ["server", "client", "provider"] as const;

export type TargetRole = (typeof TARGET_ROLES)[number];

// What the CLI reads before it calls the target (ADR 0009): its package, its role, the IR it reads, its artefacts
// and links.
export interface TargetMetadata<
  Artefact extends string = string,
  Consumed extends LinkKind = LinkKind,
  Provided extends LinkKind = LinkKind,
> {
  packageName: string;
  packageVersion: string;
  role: TargetRole;
  irSupport: IrSupport;
  artefacts: readonly ArtefactDeclaration<Artefact>[];
  consumes: LinkNeeds<Consumed>;
  provides: LinkOffers<Provided>;
  /** The boot checks the app config entry may tune; none when absent. */
  bootChecks?: readonly TunableBootCheck[];
  /**
   * The fix the CLI states when the app config sets `frameworkDocs: off`, for a target that knows no switch for its
   * framework's own docs; absent when the target has no such docs or a switch the CLI can write.
   */
  frameworkDocsOffFix?: string;
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
  hookCheck: HookBootCheck;
  /** The entry's `mount`, the path prefix every contract route is served under; empty when the entry writes none. */
  mount: string;
  /** The api's document the framework's docs follow; present exactly when the `nativeDocs` artefact is on. */
  nativeDocsDocument?: NativeDocsDocument;
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
  /** The entry's hook boot check level; `error` when absent. */
  hookCheck?: HookBootCheck;
  /** The entry's `mount`; no prefix when absent. */
  mount?: string;
  /** The parsed seampact document the `nativeDocs` artefact follows; the target refuses `nativeDocs` without it. */
  nativeDocsDocument?: NativeDocsDocument;
}

// The target as the CLI sees it, whatever its options, artefacts and links.
export interface Target {
  metadata: AnyTargetMetadata;
  parseOptions(raw: unknown): ParseOptionsOutcome<unknown>;
  generate(request: GenerateRequest): Promise<GenerateOutcome>;
  describe(ir: ContractIR, rawOptions: unknown): DescribeOutcome<DescriptorSet>;
}
