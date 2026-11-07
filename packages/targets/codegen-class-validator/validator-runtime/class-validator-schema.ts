// The Standard Schema v1 adapter over a decorated DTO class: the plain value instantiated without conversion,
// validated with the strict options, and each class-validator error named by its contract rule, the convention a
// server boundary reads (`params.rule` on a custom issue). Copied into the generated tree as is.
import { type ClassConstructor, plainToInstance } from "class-transformer";
import {
  ARRAY_MAX_SIZE,
  ARRAY_MIN_SIZE,
  IS_ARRAY,
  IS_BOOLEAN,
  IS_DIVISIBLE_BY,
  IS_IN,
  IS_INT,
  IS_NUMBER,
  IS_OBJECT,
  IS_RFC_3339,
  IS_STRING,
  IS_UUID,
  MATCHES,
  MAX,
  MIN,
  type ValidationError,
  ValidationTypes,
  validate,
} from "class-validator";
import {
  type ContractCheck,
  failingItemChecks,
  ITEM_CHECKS,
  ITEMS_CONSTRAINT,
} from "./constraints.js";
import { STRICT_VALIDATION_OPTIONS, type ValidationDirection } from "./validation-options.js";

type IssuePath = readonly PropertyKey[];

/** One issue in the shape of a custom Standard Schema issue: the contract rule is `params.rule`. */
export interface ContractIssue {
  readonly message: string;
  readonly path: IssuePath;
  readonly code: "custom";
  readonly params: { readonly rule: string };
}

export type ContractResult =
  | { readonly value: unknown; readonly issues?: undefined }
  | { readonly issues: readonly ContractIssue[] };

/** A Standard Schema v1 value. */
export interface ContractSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): Promise<ContractResult>;
  };
}

/** The request members an operation declares: path and header names kept before validation, and the body. */
export interface RequestParts {
  readonly path?: readonly string[];
  readonly headers?: readonly string[];
  readonly body: boolean;
}

const VENDOR = "seampact-class-validator";

const REQUIRED_RULE = "required";
const TYPE_RULE = "type";
const UNKNOWN_KEYS_RULE = "unknownKeys";
const UNKNOWN_VALUE_CONSTRAINT = "unknownValue";

// The rule of each class-validator constraint the generated DTOs use; a custom constraint is named after its rule,
// and so are `minLength` and `maxLength`.
const CONSTRAINT_RULES: ReadonlyMap<string, string> = new Map([
  [IS_STRING, TYPE_RULE],
  [IS_INT, TYPE_RULE],
  [IS_NUMBER, TYPE_RULE],
  [IS_BOOLEAN, TYPE_RULE],
  [IS_ARRAY, TYPE_RULE],
  [IS_OBJECT, TYPE_RULE],
  [ValidationTypes.NESTED_VALIDATION, TYPE_RULE],
  [UNKNOWN_VALUE_CONSTRAINT, TYPE_RULE],
  [IS_IN, "enum"],
  [MATCHES, "pattern"],
  [IS_UUID, "format"],
  [IS_RFC_3339, "format"],
  [MIN, "minimum"],
  [MAX, "maximum"],
  [IS_DIVISIBLE_BY, "multipleOf"],
  [ARRAY_MIN_SIZE, "minItems"],
  [ARRAY_MAX_SIZE, "maxItems"],
  [ValidationTypes.WHITELIST, UNKNOWN_KEYS_RULE],
]);

// A rule after which no other issue on the value, or below it, is reported: zod reports a wrong type alone too.
const VALUE_RULES: ReadonlySet<string> = new Set([REQUIRED_RULE, TYPE_RULE]);

/** The adapter of one schema's DTO in one direction: an input refuses unknown keys, an output strips them. */
export function dtoSchema(
  dto: ClassConstructor<object>,
  direction: ValidationDirection,
): ContractSchema {
  return standardSchema((value) => validateDto(dto, value, direction));
}

/**
 * The adapter of one operation's request DTO. Path and header members other than the declared ones are dropped
 * first, as a stripping validator would; the query and the body refuse unknown keys.
 */
export function requestSchema(dto: ClassConstructor<object>, parts: RequestParts): ContractSchema {
  return standardSchema(async (value) => {
    if (!isPlainObject(value)) return validateDto(dto, value, "input");

    const request: Record<string, unknown> = { query: value.query };

    if (parts.path !== undefined) request.path = declaredMembers(value.path, parts.path);

    if (parts.headers !== undefined)
      request.headers = declaredMembers(value.headers, parts.headers);

    if (parts.body) request.body = value.body;

    return validateDto(dto, request, "input");
  });
}

function standardSchema(run: (value: unknown) => Promise<ContractResult>): ContractSchema {
  return { "~standard": { version: 1, vendor: VENDOR, validate: run } };
}

// The plain value on success: an input as received, an output without the keys the DTOs strip.
async function validateDto(
  dto: ClassConstructor<object>,
  value: unknown,
  direction: ValidationDirection,
): Promise<ContractResult> {
  if (value === undefined) return { issues: [issue([], REQUIRED_RULE, "Expected a value.")] };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [issue([], TYPE_RULE, "Expected an object.")] };
  }

  const prototypeKeys: IssuePath[] = [];
  const copy = withoutPrototypeKeys(value, [], prototypeKeys);
  const instance = plainToInstance(dto, copy, STRICT_VALIDATION_OPTIONS.transform);
  const errors = await validate(instance, STRICT_VALIDATION_OPTIONS[direction]);
  const issues: ContractIssue[] = [];

  collectIssues(errors, [], issues);

  if (direction === "input") {
    for (const path of prototypeKeys) {
      if (isDtoInstance(valueAt(instance, path.slice(0, -1)))) {
        issues.push(issue(path, UNKNOWN_KEYS_RULE, `Unexpected member '${String(path.at(-1))}'.`));
      }
    }
  }

  const reported = reportedIssues(issues);

  if (reported.length > 0) return { issues: reported };

  return { value: direction === "input" ? value : strippedValue(value, instance) };
}

function collectIssues(
  errors: readonly ValidationError[],
  parentPath: IssuePath,
  issues: ContractIssue[],
): void {
  for (const error of errors) {
    const path = error.property === undefined ? parentPath : [...parentPath, error.property];

    issues.push(...constraintIssues(error, path));
    collectIssues(error.children ?? [], path, issues);
  }
}

// An unknown key or an absent value is one issue; a list's item checks are reported at each failing item.
function constraintIssues(error: ValidationError, path: IssuePath): ContractIssue[] {
  const constraints = Object.entries(error.constraints ?? {});

  if (constraints.length === 0) return [];

  const unknownKey = constraints.find(([name]) => name === ValidationTypes.WHITELIST);

  if (unknownKey !== undefined) return [issue(path, UNKNOWN_KEYS_RULE, unknownKey[1])];

  if (error.value === undefined) return [issue(path, REQUIRED_RULE, "Expected a value.")];

  return constraints.flatMap(([name, message]) =>
    name === ITEMS_CONSTRAINT
      ? itemIssues(error, path)
      : [issue(path, CONSTRAINT_RULES.get(name) ?? name, message)],
  );
}

function itemIssues(error: ValidationError, path: IssuePath): ContractIssue[] {
  const checks: unknown = error.contexts?.[ITEMS_CONSTRAINT]?.[ITEM_CHECKS];
  const items: unknown = error.value;

  if (!isCheckList(checks) || !Array.isArray(items)) {
    throw new Error(
      `class-validator-schema: the '${ITEMS_CONSTRAINT}' constraint at '${path.join("/")}' lost its checks; ` +
        "validate with `validationError.value` on and keep the generated decorators.",
    );
  }

  return items.flatMap((item, index) =>
    failingItemChecks(item, checks).map((check) =>
      issue([...path, index], check.rule, check.message),
    ),
  );
}

function isCheckList(value: unknown): value is readonly ContractCheck[] {
  return (
    Array.isArray(value) &&
    value.every(
      (check: unknown) =>
        typeof check === "object" &&
        check !== null &&
        typeof Reflect.get(check, "rule") === "string" &&
        typeof Reflect.get(check, "message") === "string" &&
        typeof Reflect.get(check, "test") === "function",
    )
  );
}

// A wrong type or an absent value is reported alone: every other issue at that path, or below it, is dropped. A
// rule is reported once per path: a list item that is not an object fails both its item check and `ValidateNested`.
function reportedIssues(issues: readonly ContractIssue[]): ContractIssue[] {
  const valuePaths = issues
    .filter((found) => VALUE_RULES.has(found.params.rule))
    .map((found) => found.path);
  const seen = new Set<string>();

  return issues.filter((found) => {
    const key = JSON.stringify([found.path.map(String), found.params.rule]);
    const shadowed = valuePaths.some(
      (valuePath) =>
        startsWith(found.path, valuePath) &&
        (found.path.length > valuePath.length || !VALUE_RULES.has(found.params.rule)),
    );

    if (shadowed || seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function startsWith(path: IssuePath, prefix: IssuePath): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((key, index) => String(key) === String(path[index]))
  );
}

function issue(path: IssuePath, rule: string, message: string): ContractIssue {
  return { message, path, code: "custom", params: { rule } };
}

// class-transformer sets a `__proto__` member as the prototype and skips a member named after an inherited
// method (`constructor`, `toString`), so such members are dropped before instantiation and their paths kept.
function withoutPrototypeKeys(value: unknown, path: IssuePath, dropped: IssuePath[]): unknown {
  if (Array.isArray(value))
    return value.map((item, index) => withoutPrototypeKeys(item, [...path, index], dropped));

  if (!isPlainObject(value)) return value;

  const copy: Record<string, unknown> = {};

  for (const [key, member] of Object.entries(value)) {
    if (Object.hasOwn(Object.prototype, key)) {
      dropped.push([...path, key]);
      continue;
    }

    copy[key] = withoutPrototypeKeys(member, [...path, key], dropped);
  }

  return copy;
}

// The output with only the members its DTOs keep; a value no DTO describes (an opaque member) is kept whole.
function strippedValue(value: unknown, instance: unknown): unknown {
  if (Array.isArray(value) && Array.isArray(instance)) {
    return value.map((item, index) => strippedValue(item, instance[index]));
  }

  if (!isPlainObject(value) || !isDtoInstance(instance)) return value;

  const kept = Object.entries(value).filter(
    ([key]) => Object.hasOwn(instance, key) && !Object.hasOwn(Object.prototype, key),
  );

  return Object.fromEntries(
    kept.map(([key, member]) => [key, strippedValue(member, Reflect.get(instance, key))]),
  );
}

function declaredMembers(value: unknown, names: readonly string[]): unknown {
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    names.filter((name) => Object.hasOwn(value, name)).map((name) => [name, value[name]]),
  );
}

function valueAt(value: unknown, path: IssuePath): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );
}

// An instance of a generated DTO class, as class-transformer builds it from a plain object.
function isDtoInstance(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype !== Object.prototype && prototype !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
