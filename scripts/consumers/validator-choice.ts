// The validator libraries a test consumer can generate its validators with: each id names the provider package
// written into the template's `validators` entry and the dependencies its generated code imports.

export interface ValidatorChoice {
  readonly package: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

export const DEFAULT_VALIDATOR_CHOICE = "zod";

export const VALIDATOR_CHOICES: Readonly<Record<string, ValidatorChoice>> = {
  zod: { package: "@seampact/codegen-zod", dependencies: { zod: "4.6.7" } },
};

// The choice an id names, or an error listing the known ids.
export function validatorChoice(id: string): ValidatorChoice {
  const choice = VALIDATOR_CHOICES[id];

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
