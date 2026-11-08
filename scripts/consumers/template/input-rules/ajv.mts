// The `input-rules` case's app input rules in Ajv: a custom keyword names the rule, and the unnamed one reports an
// error with an empty keyword. The consumer harness copies this file to `src/input-rules.mts` when the validators
// are Ajv.
import { Ajv, type ErrorObject, type SchemaValidateFunction } from "ajv";
import type * as InputRules from "../generated/types/inputRules/index.js";
import {
  endsAfterStart,
  noteIsNamed,
  type ScheduleWindow,
  windowWithinLimit,
} from "./input-rules-handlers.mjs";

const ajv = new Ajv({ allErrors: true });

// Ajv points a keyword's error at the value the keyword sits on, so this one names `/end` itself.
const endAfterStartKeyword: SchemaValidateFunction = (_schema, window: ScheduleWindow) => {
  if (endsAfterStart(window)) return true;

  endAfterStartKeyword.errors = [refusalAt("endAfterStart", "/end")];

  return false;
};

const unnamedKeyword: SchemaValidateFunction = (_schema, window: ScheduleWindow) => {
  if (noteIsNamed(window)) return true;

  unnamedKeyword.errors = [refusalAt("", "")];

  return false;
};

ajv.addKeyword({
  keyword: "endAfterStart",
  type: "object",
  errors: true,
  validate: endAfterStartKeyword,
});
ajv.addKeyword({
  keyword: "windowTooLong",
  type: "object",
  validate: (_schema: unknown, window: ScheduleWindow) => windowWithinLimit(window),
});
ajv.addKeyword({ keyword: "unnamedRule", type: "object", errors: true, validate: unnamedKeyword });

function refusalAt(keyword: string, instancePath: string): Partial<ErrorObject> {
  return { keyword, instancePath, params: {} };
}

const scheduleTaskBody = ajv.compile<InputRules.schemas.ScheduleTask>({
  type: "object",
  endAfterStart: true,
  windowTooLong: true,
  unnamedRule: true,
});

/** The rules of the `inputRules` api, by operation and part. */
export const inputRules = { scheduleTask: { body: scheduleTaskBody } };
