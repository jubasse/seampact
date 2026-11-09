// The `input-rules` case's app input rules in class-validator: a subclass of the generated body DTO whose custom
// constraints carry the rule's name, and the unnamed one is registered without a name. The consumer harness copies
// this file to `src/input-rules.mts` when the validators are class-validator.
import { registerDecorator, type ValidationArguments } from "class-validator";
import { inputDtos } from "../generated/validators/inputRules/index.js";
import {
  endsAfterStart,
  noteIsNamed,
  type ScheduleWindow,
  windowWithinLimit,
} from "./input-rules-handlers.mjs";

class ScheduleTaskRules extends inputDtos.ScheduleTaskDto {}

registerDecorator({
  name: "endAfterStart",
  target: ScheduleTaskRules,
  propertyName: "end",
  validator: {
    validate: (_end: unknown, args: ValidationArguments) => endsAfterStart(windowOf(args)),
  },
});

// class-validator has no class-level constraint: a cross-member rule sits on a member and points at it.
registerDecorator({
  name: "windowTooLong",
  target: ScheduleTaskRules,
  propertyName: "start",
  validator: {
    validate: (_start: unknown, args: ValidationArguments) => windowWithinLimit(windowOf(args)),
  },
});

registerDecorator({
  target: ScheduleTaskRules,
  propertyName: "note",
  validator: {
    validate: (_note: unknown, args: ValidationArguments) => noteIsNamed(windowOf(args)),
  },
});

function windowOf(args: ValidationArguments): ScheduleWindow {
  if (!(args.object instanceof ScheduleTaskRules)) {
    throw new Error("the input rules validated another class than ScheduleTaskRules");
  }

  return args.object;
}

/** The rules of the `inputRules` api, by operation and part. */
export const inputRules = { scheduleTask: { body: ScheduleTaskRules } };
