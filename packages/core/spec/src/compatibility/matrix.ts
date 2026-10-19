// The first-party providers a link can name, the server targets with the framework majors they support and the
// validator styles they accept, and the validators a target will generate itself once they ship.

export type ProviderKind = "validators" | "types";

export type ValidatorStyle = "standard-schema" | "class-validator";

export type ProviderStyle = ValidatorStyle | "typescript";

export interface FirstPartyProvider {
  // The id a tool selects the provider by, such as the consumer and bench `--validators <id>`.
  readonly id: string;
  readonly package: string;
  readonly kind: ProviderKind;
  readonly style: ProviderStyle;
}

// A validator a target generates itself, with no link, recorded before it ships so its pairs are known.
export interface PlannedValidator {
  readonly id: string;
  readonly library: string;
}

export interface FrameworkSupport {
  readonly package: string;
  readonly supportedMajors: readonly number[];
}

export interface TargetCompatibility {
  readonly package: string;
  readonly framework: FrameworkSupport;
  readonly validatorStyles: readonly ValidatorStyle[];
  readonly plannedValidators: readonly PlannedValidator[];
}

// One offered combination of a target, a framework major and a validator provider.
export interface ValidatorPair {
  readonly target: string;
  readonly framework: string;
  readonly frameworkMajor: number;
  readonly validator: string;
  readonly validatorPackage: string;
}

// In the order a refusal names them.
export const FIRST_PARTY_PROVIDERS: readonly FirstPartyProvider[] = [
  { id: "zod", package: "@seampact/codegen-zod", kind: "validators", style: "standard-schema" },
  { id: "yup", package: "@seampact/codegen-yup", kind: "validators", style: "standard-schema" },
  {
    id: "class-validator",
    package: "@seampact/codegen-class-validator",
    kind: "validators",
    style: "class-validator",
  },
  { id: "ts", package: "@seampact/codegen-ts", kind: "types", style: "typescript" },
];

export const SERVER_TARGETS: readonly TargetCompatibility[] = [
  {
    package: "@seampact/codegen-nestjs",
    framework: { package: "@nestjs/core", supportedMajors: [12] },
    validatorStyles: ["standard-schema", "class-validator"],
    plannedValidators: [],
  },
  {
    package: "@seampact/codegen-express",
    framework: { package: "express", supportedMajors: [4, 5] },
    validatorStyles: ["standard-schema"],
    plannedValidators: [],
  },
  {
    package: "@seampact/codegen-fastify",
    framework: { package: "fastify", supportedMajors: [5] },
    validatorStyles: ["standard-schema"],
    plannedValidators: [{ id: "ajv", library: "ajv" }],
  },
  {
    package: "@seampact/codegen-adonis",
    framework: { package: "@adonisjs/core", supportedMajors: [6, 7] },
    validatorStyles: ["standard-schema"],
    plannedValidators: [{ id: "vinejs", library: "@vinejs/vine" }],
  },
  {
    package: "@seampact/codegen-hono",
    framework: { package: "hono", supportedMajors: [4] },
    validatorStyles: ["standard-schema"],
    plannedValidators: [],
  },
];

// The matrix entry of a server target package, or an error naming the recorded ones.
export function serverTargetCompatibility(targetPackage: string): TargetCompatibility {
  const entry = SERVER_TARGETS.find((target) => target.package === targetPackage);

  if (entry === undefined) {
    const recordedPackages = SERVER_TARGETS.map((target) => target.package).join(", ");
    throw new Error(
      `compatibility: '${targetPackage}' is not a server target of the matrix; recorded: ${recordedPackages}.`,
    );
  }

  return entry;
}

// The first-party packages that provide a style, in matrix order.
export function firstPartyPackagesOfStyle(style: ProviderStyle): readonly string[] {
  return FIRST_PARTY_PROVIDERS.filter((provider) => provider.style === style).map(
    (provider) => provider.package,
  );
}

// Every offered target, framework major and validator provider combination; planned validators are not offered.
export function offeredValidatorPairs(): readonly ValidatorPair[] {
  return SERVER_TARGETS.flatMap((target) =>
    target.framework.supportedMajors.flatMap((frameworkMajor) =>
      validatorProvidersOf(target).map((provider) => ({
        target: target.package,
        framework: target.framework.package,
        frameworkMajor,
        validator: provider.id,
        validatorPackage: provider.package,
      })),
    ),
  );
}

function validatorProvidersOf(target: TargetCompatibility): readonly FirstPartyProvider[] {
  return FIRST_PARTY_PROVIDERS.filter(
    (provider) =>
      provider.kind === "validators" &&
      target.validatorStyles.some((style) => style === provider.style),
  );
}
