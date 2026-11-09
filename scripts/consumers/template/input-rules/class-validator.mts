// The `input-rules` case's app input rules in class-validator: a subclass of the generated body DTO whose custom
// constraints carry the rule's name, and the unnamed one is a `registerDecorator` validator without a name. The
// consumer harness copies this file to `src/input-rules.mts` when the validators are class-validator.
import {
  registerDecorator,
  type ValidationArguments,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";
import { inputDtos } from "../generated/validators/inputRules/index.js";
import {
  endsAfterStart,
  noteIsNamed,
  type ScheduleWindow,
  windowWithinLimit,
} from "./input-rules-handlers.mjs";

@ValidatorConstraint({ name: "endAfterStart" })
class EndAfterStart implements ValidatorConstraintInterface {
  validate(_end: unknown, args: ValidationArguments): boolean {
    return endsAfterStart(windowOf(args));
  }
}

// class-validator has no class-level constraint: a cross-member rule sits on a member and points at it.
@ValidatorConstraint({ name: "windowTooLong" })
class WindowTooLong implements ValidatorConstraintInterface {
  validate(_start: unknown, args: ValidationArguments): boolean {
    return windowWithinLimit(windowOf(args));
  }
}

class ScheduleTaskRules extends inputDtos.ScheduleTaskDto {
  @Validate(WindowTooLong)
  override start!: string;

  @Validate(EndAfterStart)
  override end!: string;
}

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
