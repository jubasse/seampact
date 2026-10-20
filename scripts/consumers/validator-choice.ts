// The validator libraries a test consumer can generate its validators with: each id is a validator provider of the
// compatibility matrix, naming the provider package written into the template's `validators` entry and the
// dependencies its generated code imports. A validator the target generates itself names no package: the consumer
// has no `validators` entry and link, and only adds the library.

import { FIRST_PARTY_PROVIDERS, SERVER_TARGETS } from "@seampact/spec/compatibility";

export interface ValidatorChoice {
  // Absent for a validator the target generates itself.
  readonly package: string | undefined;
  readonly dependencies: Readonly<Record<string, string>>;
}

export const DEFAULT_VALIDATOR_CHOICE = "zod";

// The libraries each validator provider's generated code imports, keyed by the matrix provider id.
const VALIDATOR_DEPENDENCIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  zod: { zod: "4.6.7" },
  yup: { yup: "1.7.1" },
  "class-validator": { "class-validator": "0.15.1", "class-transformer": "0.5.1" },
  ajv: { ajv: "8.20.0" },
  vinejs: { "@vinejs/vine": "4.4.0" },
};

// The ids a target generates itself, which no provider package serves.
const OWN_VALIDATOR_IDS: ReadonlySet<string> = new Set(
  SERVER_TARGETS.flatMap((target) => target.ownValidators.map((validator) => validator.id)),
);

// One choice per validator of the compatibility matrix, under its id: the first-party providers, then the
// validators the targets generate themselves.
export const VALIDATOR_CHOICES: Readonly<Record<string, ValidatorChoice>> = Object.fromEntries([
  ...FIRST_PARTY_PROVIDERS.filter((provider) => provider.kind === "validators").map((provider) => [
    provider.id,
    { package: provider.package, dependencies: validatorDependencies(provider.id) },
  ]),
  ...[...OWN_VALIDATOR_IDS].map((id) => [
    id,
    { package: undefined, dependencies: validatorDependencies(id) },
  ]),
]);

refuseDependenciesWithoutProvider();

function validatorDependencies(providerId: string): Readonly<Record<string, string>> {
  const dependencies = Object.hasOwn(VALIDATOR_DEPENDENCIES, providerId)
    ? VALIDATOR_DEPENDENCIES[providerId]
    : undefined;

  if (dependencies === undefined) {
    throw new Error(
      `consumers: the matrix validator provider '${providerId}' has no dependencies in validator-choice.ts; add its libraries there.`,
    );
  }

  return dependencies;
}

function refuseDependenciesWithoutProvider(): void {
  const unknownIds = Object.keys(VALIDATOR_DEPENDENCIES).filter(
    (providerId) => !Object.hasOwn(VALIDATOR_CHOICES, providerId),
  );

  if (unknownIds.length > 0) {
    throw new Error(
      `consumers: validator-choice.ts lists dependencies for ${unknownIds.join(", ")}, which the compatibility matrix does not offer as validator providers.`,
    );
  }
}

// The choice an id names, or an error listing the known ids.
export function validatorChoice(id: string): ValidatorChoice {
  const choice = Object.hasOwn(VALIDATOR_CHOICES, id) ? VALIDATOR_CHOICES[id] : undefined;

  if (choice === undefined) {
    throw new Error(
      `consumers: no validator choice '${id}'; known choices: ${knownValidatorChoices()}.`,
    );
  }

  return choice;
}

export function isValidatorChoice(id: string): boolean {
  return Object.hasOwn(VALIDATOR_CHOICES, id);
}

export function knownValidatorChoices(): string {
  return Object.keys(VALIDATOR_CHOICES).sort().join(", ");
}
