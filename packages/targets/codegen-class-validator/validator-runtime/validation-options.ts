// The strict options every generated adapter validates with. Copied into the generated tree as is.
import type { ClassTransformOptions } from "class-transformer";
import type { ValidatorOptions } from "class-validator";

// An input refuses every unknown key and an output strips it, as the zod validators do; every issue is reported.
// `forbidUnknownValues` stays off: a contract object without members has no metadata and would be refused whole,
// and the adapter instantiates every object through its DTO class, so no object reaches validation without one.
// No value is converted: the boundary has already decoded each wire string by its contract type.
export const STRICT_VALIDATION_OPTIONS = Object.freeze({
  input: Object.freeze({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
    stopAtFirstError: false,
    validationError: Object.freeze({ target: true, value: true }),
  }) satisfies ValidatorOptions,
  output: Object.freeze({
    whitelist: true,
    forbidNonWhitelisted: false,
    forbidUnknownValues: false,
    stopAtFirstError: false,
    validationError: Object.freeze({ target: true, value: true }),
  }) satisfies ValidatorOptions,
  transform: Object.freeze({
    enableImplicitConversion: false,
    exposeDefaultValues: false,
  }) satisfies ClassTransformOptions,
});

export type ValidationDirection = "input" | "output";
