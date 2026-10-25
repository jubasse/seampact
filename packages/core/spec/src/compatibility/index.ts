// The compatibility matrix (`@seampact/spec/compatibility`): the first-party providers of each link kind, per server target the framework majors it is tested on or refuses and the validator styles it accepts, and per client target the framework and query library majors it is tested on and the client link styles it reads.
// The data is `compatibility/matrix.json`, which the JVM build plugins read too; this file types it and adds the
// queries. Its one relative import is that JSON file, so the repository scripts that Node runs from source can import it.

import matrix from "../../compatibility/matrix.json" with { type: "json" };

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

const PROVIDER_KINDS: readonly ProviderKind[] = ["validators", "types", "client"];
const VALIDATOR_STYLES: readonly ValidatorStyle[] = ["standard-schema", "class-validator"];
const CLIENT_STYLES: readonly ClientStyle[] = ["fetch"];
const PROVIDER_STYLES: readonly ProviderStyle[] = [
  ...VALIDATOR_STYLES,
  "typescript",
  ...CLIENT_STYLES,
];

function isOneOf<Value extends string>(value: string, allowed: readonly Value[]): value is Value {
  const allowedValues: readonly string[] = allowed;

  return allowedValues.includes(value);
}

// The matrix file holds plain strings; a value outside its union is a broken data file, named with where it sits.
function oneOf<Value extends string>(
  value: string,
  allowed: readonly Value[],
  where: string,
): Value {
  if (isOneOf(value, allowed)) return value;

  throw new Error(
    `compatibility: matrix.json ${where} is '${value}', not one of ${allowed.join(", ")}.`,
  );
}

type MatrixTarget = (typeof matrix.serverTargets)[number];

function targetOf(target: MatrixTarget): TargetCompatibility {
  return {
    ...target,
    validatorStyles: target.validatorStyles.map((style) =>
      oneOf(style, VALIDATOR_STYLES, `${target.package} validatorStyles`),
    ),
  };
}

// In the order a refusal names them.
export const FIRST_PARTY_PROVIDERS: readonly FirstPartyProvider[] = matrix.firstPartyProviders.map(
  (provider) => ({
    ...provider,
    kind: oneOf(provider.kind, PROVIDER_KINDS, `${provider.id} kind`),
    style: oneOf(provider.style, PROVIDER_STYLES, `${provider.id} style`),
  }),
);

export const SERVER_TARGETS: readonly TargetCompatibility[] = matrix.serverTargets.map(targetOf);

export const CLIENT_TARGETS: readonly ClientTargetCompatibility[] = matrix.clientTargets.map(
  (target) => ({
    ...targetOf(target),
    clientStyles: target.clientStyles.map((style) =>
      oneOf(style, CLIENT_STYLES, `${target.package} clientStyles`),
    ),
  }),
);

// The targets the Gradle and Maven plugins generate: `package` is the `use` coordinates and `framework.package` the
// `group:artifact` whose version the build resolves on the compile classpath. They accept no validator link.
export interface JvmTargetCompatibility {
  readonly package: string;
  readonly framework: FrameworkSupport;
}

export const JVM_TARGETS: readonly JvmTargetCompatibility[] = matrix.jvmTargets;

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
