// The compatibility matrix (`@seampact/spec/compatibility`): the first-party providers, and per server target the framework majors it is tested on or refuses and the validator styles it accepts.
// One file with no relative import, so the repository scripts that Node runs from source can import it.

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

// A validator a target generates itself when its entry gives no `validators` link; the library is an app dependency.
export interface OwnValidator {
  readonly id: string;
  readonly library: string;
}

// A framework major a consumer project runs the target on; `consumer` is its overlay under `scripts/consumers/targets`.
export interface TestedMajor {
  readonly major: number;
  readonly consumer: string;
}

// A framework major the target is known not to work on, refused even when the app config allows it untested.
export interface IncompatibleMajor {
  readonly major: number;
  readonly reason: string;
}

// `id` is the name the app config's `allowUntested` and the diagnostics use; `package` is the one whose installed
// version the compatibility check reads.
export interface FrameworkSupport {
  readonly id: string;
  readonly package: string;
  readonly tested: readonly TestedMajor[];
  readonly incompatible: readonly IncompatibleMajor[];
}

export interface TargetCompatibility {
  readonly package: string;
  readonly framework: FrameworkSupport;
  readonly validatorStyles: readonly ValidatorStyle[];
  readonly ownValidators: readonly OwnValidator[];
}

// One offered combination of a target, a framework major and a validator provider.
export interface ValidatorPair {
  readonly target: string;
  readonly framework: string;
  readonly frameworkMajor: number;
  // The consumer overlay that tests this framework major.
  readonly consumer: string;
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
    framework: {
      id: "nestjs",
      package: "@nestjs/core",
      tested: [{ major: 12, consumer: "nestjs" }],
      incompatible: [],
    },
    validatorStyles: ["standard-schema", "class-validator"],
    ownValidators: [],
  },
  {
    package: "@seampact/codegen-express",
    framework: {
      id: "express",
      package: "express",
      tested: [
        { major: 4, consumer: "express4" },
        { major: 5, consumer: "express" },
      ],
      incompatible: [],
    },
    validatorStyles: ["standard-schema"],
    ownValidators: [],
  },
  {
    package: "@seampact/codegen-fastify",
    framework: {
      id: "fastify",
      package: "fastify",
      tested: [{ major: 5, consumer: "fastify" }],
      incompatible: [],
    },
    validatorStyles: ["standard-schema"],
    ownValidators: [{ id: "ajv", library: "ajv" }],
  },
  {
    package: "@seampact/codegen-adonis",
    framework: {
      id: "adonis",
      package: "@adonisjs/core",
      tested: [
        { major: 6, consumer: "adonis6" },
        { major: 7, consumer: "adonis" },
      ],
      incompatible: [],
    },
    validatorStyles: ["standard-schema"],
    ownValidators: [{ id: "vinejs", library: "@vinejs/vine" }],
  },
  {
    package: "@seampact/codegen-hono",
    framework: {
      id: "hono",
      package: "hono",
      tested: [{ major: 4, consumer: "hono" }],
      incompatible: [],
    },
    validatorStyles: ["standard-schema"],
    ownValidators: [],
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

// The framework majors a consumer project tests the target on, in matrix order.
export function supportedMajorsOf(target: TargetCompatibility): readonly number[] {
  return target.framework.tested.map((tested) => tested.major);
}

// The first-party packages that provide a style, in matrix order.
export function firstPartyPackagesOfStyle(style: ProviderStyle): readonly string[] {
  return FIRST_PARTY_PROVIDERS.filter((provider) => provider.style === style).map(
    (provider) => provider.package,
  );
}

// Every offered target, framework major and validator provider combination; a target's own validators have the target package as their validator package.
export function offeredValidatorPairs(): readonly ValidatorPair[] {
  return SERVER_TARGETS.flatMap((target) =>
    target.framework.tested.flatMap((tested) =>
      validatorPackagesOf(target).map((provider) => ({
        target: target.package,
        framework: target.framework.package,
        frameworkMajor: tested.major,
        consumer: tested.consumer,
        validator: provider.id,
        validatorPackage: provider.package,
      })),
    ),
  );
}

interface OfferedValidatorPackage {
  readonly id: string;
  readonly package: string;
}

// The linkable providers of the accepted styles, then the target's own validators.
function validatorPackagesOf(target: TargetCompatibility): readonly OfferedValidatorPackage[] {
  const own = target.ownValidators.map((validator) => ({
    id: validator.id,
    package: target.package,
  }));

  return [...validatorProvidersOf(target), ...own];
}

function validatorProvidersOf(target: TargetCompatibility): readonly FirstPartyProvider[] {
  return FIRST_PARTY_PROVIDERS.filter(
    (provider) =>
      provider.kind === "validators" &&
      target.validatorStyles.some((style) => style === provider.style),
  );
}
