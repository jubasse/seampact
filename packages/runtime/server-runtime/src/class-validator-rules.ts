// App input rules in class-validator on NestJS (ADR 0028 section 4): the class the app registers for a part, the
// class-validator calls the generated route table hands the runtime, and the pointer and name of each refusal.
import { jsonPointer } from "./input-issues.js";
import type { InputRuleAdapter, InputRuleRefusal, WidenedPart } from "./input-rule-libraries.js";

/** A class whose instances have the part's members: a subclass of the part's generated DTO, or the app's own class. */
export type InputRuleClass<Part> = abstract new (...dependencies: never) => WidenedPart<Part>;

/** One error of class-validator's `validate()`, as its `ValidationError` reports it. */
export interface ClassValidatorError {
  readonly property?: string;
  readonly constraints?: Readonly<Record<string, string>>;
  readonly children?: readonly ClassValidatorError[];
}

/**
 * The class-validator calls of an api whose validators are class-validator's, imported by the generated route table
 * from the app's own `class-transformer` and `class-validator`, with the strict options the generated adapter
 * validates its input with; the rules run with them, the whitelist left out.
 */
export interface ClassValidatorCalls {
  plainToInstance(rule: object, plain: unknown, options: object): unknown;
  validate(instance: object, options: object): Promise<readonly ClassValidatorError[]>;
  getMetadataStorage(): {
    getTargetValidationMetadatas(
      rule: object,
      schema: string,
      always: boolean,
      strictGroups: boolean,
    ): readonly unknown[];
  };
  readonly options: { readonly input: object; readonly transform: object };
}

// The constraint key class-validator gives a `registerDecorator` validator registered without a name.
const UNNAMED_CONSTRAINT = "customValidation";
const ALL_GROUPS = "";

// Step 6 already refused every unknown key, and a rule class may be the app's own class that decorates only the
// members its rules read, so the rules run without the whitelist the generated adapter validates with.
const RULE_WHITELIST_OPTIONS = Object.freeze({ whitelist: false, forbidNonWhitelisted: false });

/** The class-validator adapter over the calls of one api. */
export function classValidatorAdapter(calls: ClassValidatorCalls): InputRuleAdapter {
  return {
    expected:
      "a class with class-validator constraints: a subclass of the part's generated DTO, or the app's own class",
    namingFix:
      "name the constraint, `@ValidatorConstraint({ name: '<name>' })` or `registerDecorator({ name: '<name>' })`",
    accepts: (rule) => hasConstraints(calls, rule),
    refusals: async (rule, copy) => {
      if (typeof rule !== "function") throw new Error("seampact: an input rule is not a class");

      const instance = calls.plainToInstance(rule, copy, calls.options.transform);

      if (typeof instance !== "object" || instance === null) {
        throw new Error("seampact: class-transformer gave no instance of an input rule class");
      }

      const ruleOptions = { ...calls.options.input, ...RULE_WHITELIST_OPTIONS };

      return classValidatorRefusals(await calls.validate(instance, ruleOptions));
    },
  };
}

/** Every refusal of a class-validator error tree: one per constraint, at its property's wire pointer. */
export function classValidatorRefusals(
  errors: readonly ClassValidatorError[],
  parentKeys: readonly string[] = [],
): InputRuleRefusal[] {
  return errors.flatMap((error) => {
    const keys = error.property === undefined ? parentKeys : [...parentKeys, error.property];
    const pointer = jsonPointer(keys);
    const own = Object.keys(error.constraints ?? {}).map((constraint) => ({
      pointer,
      name: constraint === UNNAMED_CONSTRAINT ? undefined : constraint,
    }));

    return [...own, ...classValidatorRefusals(error.children ?? [], keys)];
  });
}

// A class carries class-validator metadata when it, or a class it extends, declares a constraint.
function hasConstraints(calls: ClassValidatorCalls, rule: unknown): boolean {
  if (typeof rule !== "function") return false;

  return (
    calls.getMetadataStorage().getTargetValidationMetadatas(rule, ALL_GROUPS, true, false).length >
    0
  );
}
