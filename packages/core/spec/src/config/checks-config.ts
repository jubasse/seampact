import type { JsonSchema } from "../authoring/schemas.js";

// The `checks` keys of the app and root configs (ADR 0011 "The app config"): how `check` reports a drift of the
// OpenAPI documents or of the generated files, and how the compatibility matrix reports an untested framework.

// `error` fails `check` (the default), `warning` reports and passes, `disabled` skips the check.
export const CHECK_LEVELS = ["error", "warning", "disabled"] as const;

export type CheckLevel = (typeof CHECK_LEVELS)[number];

// `allowUntested` silences one framework major, so the matrix check has no `disabled`.
export const MATRIX_CHECK_LEVELS = ["error", "warning"] as const;

export type MatrixCheckLevel = (typeof MATRIX_CHECK_LEVELS)[number];

// An untested framework major is not known to be broken, so it warns unless the app asks for `error` (ADR 0009).
export const DEFAULT_MATRIX_CHECK_LEVEL: MatrixCheckLevel = "warning";

export interface AppChecks {
  openapi?: CheckLevel;
  generated?: CheckLevel;
  matrix?: MatrixCheckLevel;
}

// A root checks its merged documents only; `generated` and `matrix` concern an app's own targets.
export interface RootChecks {
  openapi?: CheckLevel;
}

export const APP_CHECKS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    openapi: { enum: [...CHECK_LEVELS] },
    generated: { enum: [...CHECK_LEVELS] },
    matrix: { enum: [...MATRIX_CHECK_LEVELS] },
  },
};

export const ROOT_CHECKS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { openapi: { enum: [...CHECK_LEVELS] } },
};
