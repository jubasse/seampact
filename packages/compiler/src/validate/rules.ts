// The rule ids of the validate stage (ADR 0006 section 4): stable, kebab case.
export const validateRules = {
  unknownKeyword: "seampact/validate/unknown-keyword",
  refusedKeyword: "seampact/validate/refused-keyword",
  reasonRequired: "seampact/validate/reason-required",
  missingKeyword: "seampact/validate/missing-keyword",
  conflictingKeywords: "seampact/validate/conflicting-keywords",
  invalidName: "seampact/validate/invalid-name",
  wrongType: "seampact/validate/wrong-type",
  invalidValue: "seampact/validate/invalid-value",
} as const;

export type ValidateRule = (typeof validateRules)[keyof typeof validateRules];
