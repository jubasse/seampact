// The codes of the diff's refusals and gate failures.

export const DIFF_CODES = {
  irVersionDiffers: "diff.irVersion.differs",
  irRevisionDiffers: "diff.irRevision.differs",
  apiNameDiffers: "diff.api.name.differs",
  apiVersionDiffers: "diff.api.version.differs",
  unknownValue: "diff.ir.unknownValue",
  policyBreaking: "diff.policy.breaking",
  maturityStable: "diff.maturity.stable",
} as const;

export type DiffCode = (typeof DIFF_CODES)[keyof typeof DIFF_CODES];
