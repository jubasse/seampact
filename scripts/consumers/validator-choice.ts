// The validator libraries a test consumer can generate its validators with: each id is a validator provider of the
// compatibility matrix, naming the provider package written into the template's `validators` entry and the
// dependencies its generated code imports.

import { FIRST_PARTY_PROVIDERS } from "@seampact/spec/compatibility";

export interface ValidatorChoice {
  readonly package: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

export const DEFAULT_VALIDATOR_CHOICE = "zod";

// The libraries each validator provider's generated code imports, keyed by the matrix provider id.
const VALIDATOR_DEPENDENCIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  zod: { zod: "4.6.7" },
  yup: { yup: "1.7.1" },
  "class-validator": { "class-validator": "0.15.1", "class-transformer": "0.5.1" },
};

// One choice per validator provider of the compatibility matrix, under its provider id.
export const VALIDATOR_CHOICES: Readonly<Record<string, ValidatorChoice>> = Object.fromEntries(
  FIRST_PARTY_PROVIDERS.filter((provider) => provider.kind === "validators").map((provider) => [
    provider.id,
    { package: provider.package, dependencies: validatorDependencies(provider.id) },
  ]),
);

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
