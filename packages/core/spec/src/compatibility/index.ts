// The compatibility matrix (`@seampact/spec/compatibility`): the first-party providers of each link kind, per server target the framework majors it is tested on or refuses and the validator styles it accepts, and per client target the framework and query library majors it is tested on and the client link styles it reads.
// One file with no relative import, so the repository scripts that Node runs from source can import it.

export type ProviderKind = "validators" | "types" | "client";

export type ValidatorStyle = "standard-schema" | "class-validator";

export type ClientStyle = "fetch";

export type ProviderStyle = ValidatorStyle | "typescript" | ClientStyle;

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

// A library the target's generated code imports for one artefact: the app installs it when the artefact is on, and
// `id` is the name `allowUntested` and the diagnostics use for it.
export interface LibrarySupport {
  readonly id: string;
  readonly package: string;
  readonly artefact: string;
  readonly testedMajors: readonly number[];
  // A library only some option values import, such as the query library of a client target; absent, every entry of the target imports it.
  readonly selectedBy?: LibrarySelector;
}

export interface LibrarySelector {
  readonly option: string;
  readonly value: string;
}

export interface TargetCompatibility {
  readonly package: string;
  readonly framework: FrameworkSupport;
  readonly libraries?: readonly LibrarySupport[];
  readonly validatorStyles: readonly ValidatorStyle[];
  readonly ownValidators: readonly OwnValidator[];
}

// A client target consumes a `client` link instead of providing validators, so it accepts no validator style.
export interface ClientTargetCompatibility extends TargetCompatibility {
  // The styles of the `client` link the target reads.
  readonly clientStyles: readonly ClientStyle[];
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
  { id: "fetch", package: "@seampact/codegen-fetch", kind: "client", style: "fetch" },
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
    libraries: [
      {
        id: "nestjs-swagger",
        package: "@nestjs/swagger",
        artefact: "nativeDocs",
        testedMajors: [12],
      },
    ],
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
    libraries: [
      {
        id: "fastify-swagger",
        package: "@fastify/swagger",
        artefact: "nativeDocs",
        testedMajors: [9],
      },
    ],
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

export const CLIENT_TARGETS: readonly ClientTargetCompatibility[] = [
  {
    package: "@seampact/codegen-react",
    framework: {
      id: "react",
      package: "react",
      tested: [{ major: 19, consumer: "react-tanstack" }],
      incompatible: [],
    },
    libraries: [
      {
        id: "tanstack-query",
        package: "@tanstack/react-query",
        artefact: "queries",
        testedMajors: [5],
        selectedBy: { option: "query", value: "tanstack" },
      },
      {
        id: "swr",
        package: "swr",
        artefact: "queries",
        testedMajors: [2],
        selectedBy: { option: "query", value: "swr" },
      },
      {
        id: "reduxjs-toolkit",
        package: "@reduxjs/toolkit",
        artefact: "queries",
        testedMajors: [2],
        selectedBy: { option: "query", value: "rtk" },
      },
      {
        id: "react-redux",
        package: "react-redux",
        artefact: "queries",
        testedMajors: [9],
        selectedBy: { option: "query", value: "rtk" },
      },
    ],
    validatorStyles: [],
    ownValidators: [],
    clientStyles: ["fetch"],
  },
  {
    package: "@seampact/codegen-vue",
    framework: {
      id: "vue",
      package: "vue",
      tested: [{ major: 3, consumer: "vue-tanstack" }],
      incompatible: [],
    },
    libraries: [
      {
        id: "tanstack-vue-query",
        package: "@tanstack/vue-query",
        artefact: "queries",
        testedMajors: [5],
        selectedBy: { option: "query", value: "tanstack" },
      },
      {
        id: "pinia-colada",
        package: "@pinia/colada",
        artefact: "queries",
        testedMajors: [1],
        selectedBy: { option: "query", value: "pinia-colada" },
      },
    ],
    validatorStyles: [],
    ownValidators: [],
    clientStyles: ["fetch"],
  },
  {
    package: "@seampact/codegen-angular",
    framework: {
      id: "angular",
      package: "@angular/core",
      tested: [{ major: 22, consumer: "angular-fetch" }],
      incompatible: [],
    },
    libraries: [
      {
        id: "ngrx-store",
        package: "@ngrx/store",
        artefact: "service",
        testedMajors: [22],
        selectedBy: { option: "state", value: "ngrx" },
      },
      {
        id: "ngrx-effects",
        package: "@ngrx/effects",
        artefact: "service",
        testedMajors: [22],
        selectedBy: { option: "state", value: "ngrx" },
      },
      {
        id: "ngrx-signals",
        package: "@ngrx/signals",
        artefact: "service",
        testedMajors: [22],
        selectedBy: { option: "state", value: "ngrx-signals" },
      },
    ],
    validatorStyles: [],
    ownValidators: [],
    clientStyles: ["fetch"],
  },
];

// Every target the matrix records, servers then clients.
export const ALL_TARGETS: readonly TargetCompatibility[] = [...SERVER_TARGETS, ...CLIENT_TARGETS];

// The matrix entry of a client target package, or an error naming the recorded ones.
export function clientTargetCompatibility(targetPackage: string): ClientTargetCompatibility {
  const entry = CLIENT_TARGETS.find((target) => target.package === targetPackage);

  if (entry === undefined) {
    const recordedPackages = CLIENT_TARGETS.map((target) => target.package).join(", ");

    throw new Error(
      `compatibility: '${targetPackage}' is not a client target of the matrix; recorded: ${recordedPackages}.`,
    );
  }

  return entry;
}

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
