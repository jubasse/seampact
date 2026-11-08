// The validator libraries an app writes its input rules in on Express, Fastify and Hono (ADR 0028 section 4): each
// library's schema type over a part, the kind of value it registers, its call on a copy of the part, and the pointer
// and name of each refusal it reports through its own channel.
import { jsonPointer } from "./input-issues.js";
import { isPlainObject } from "./plain-object.js";

/** The libraries input rules are written in, named by the generated validators' Standard Schema vendor. */
export const INPUT_RULE_LIBRARIES = ["zod", "yup", "ajv"] as const;

export type InputRuleLibrary = (typeof INPUT_RULE_LIBRARIES)[number];

/** One refusal a rule reported: the pointer inside its part, and the rule's name when the library gave one. */
export interface InputRuleRefusal {
  readonly pointer: string;
  readonly name: unknown;
}

/** How the runtime calls the rules of one library, and what the app passes for it. */
export interface InputRuleAdapter {
  /** The value the app registers, for a boot problem's fix. */
  readonly expected: string;
  /** Where the library reads a rule's name, for the fix of a rule without a usable one. */
  readonly namingFix: string;
  accepts(rule: unknown): boolean;
  /** The refusals of a rule on its copy of the part, empty when it passes; a rule that throws rejects. */
  refusals(rule: unknown, copy: unknown): Promise<readonly InputRuleRefusal[]>;
}

// Optional members widened to `T | undefined`, nested: yup infers an optional member that way on a required key,
// and zod adds `undefined` to an optional member, which `exactOptionalPropertyTypes` refuses otherwise.
type RequiredKeys<Part> = {
  [Key in keyof Part]-?: Record<string, never> extends Pick<Part, Key> ? never : Key;
}[keyof Part];

export type WidenedPart<Part> = Part extends readonly (infer Item)[]
  ? readonly WidenedPart<Item>[]
  : Part extends object
    ? {
        [Key in keyof Part]: Key extends RequiredKeys<Part>
          ? WidenedPart<Part[Key]>
          : WidenedPart<Part[Key]> | undefined;
      }
    : Part;

/** A zod schema whose input is the part: `ZodType<unknown, Part>`, read without importing zod. */
export interface ZodInputRule<Part> {
  readonly _zod: { readonly input: WidenedPart<Part> };
}

/** A yup schema whose output is the part, as `Schema<Part>` declares it. */
export interface YupInputRule<Part> {
  readonly __isYupSchema__: boolean;
  readonly __outputType: WidenedPart<Part>;
}

/** An Ajv validate function compiled for the part, `ajv.compile<Part>(schema)`, sync or `$async`. */
export interface AjvInputRule<Part> {
  (data: unknown): data is WidenedPart<Part>;
  readonly schema: unknown;
  readonly schemaEnv: unknown;
}

/**
 * The schema type of one part's rules in the library of the api's generated validator `Validator`: a misspelt part,
 * a missing member or another library's schema does not compile.
 */
export type InputRuleSchema<Validator, Part> = Validator extends { readonly _zod: unknown }
  ? ZodInputRule<Part>
  : Validator extends { readonly __isYupSchema__: unknown }
    ? YupInputRule<Part>
    : Validator extends { readonly "~standard": { readonly vendor: "ajv" } }
      ? AjvInputRule<Part>
      : never;

const ROOT_POINTER = "";

/** The library of the api's generated validators, read from their Standard Schema vendor; undefined for another. */
export function inputRuleLibraryOf(validator: unknown): InputRuleLibrary | undefined {
  const standard: unknown =
    typeof validator === "object" && validator !== null
      ? Reflect.get(validator, "~standard")
      : undefined;
  const vendor: unknown = isPlainObject(standard) ? standard.vendor : undefined;

  return INPUT_RULE_LIBRARIES.find((library) => library === vendor);
}

/** The adapter of each library. */
export const INPUT_RULE_ADAPTERS: Readonly<Record<InputRuleLibrary, InputRuleAdapter>> = {
  zod: {
    expected: "a zod schema of the part",
    namingFix: "give the refinement `params: { rule: '<name>' }`",
    accepts: (rule) =>
      isObjectWith(rule, "_zod") && typeof Reflect.get(rule, "safeParseAsync") === "function",
    refusals: zodRefusals,
  },
  yup: {
    expected: "a yup schema of the part",
    namingFix: "give the test a name, `.test({ name: '<name>', test })`",
    accepts: (rule) =>
      isObjectWith(rule, "__isYupSchema__") && typeof Reflect.get(rule, "validate") === "function",
    refusals: yupRefusals,
  },
  ajv: {
    expected: "a validate function compiled by Ajv, `ajv.compile(schema)`",
    namingFix: "name the keyword with a letter followed by letters, digits, '_', '.' or '-'",
    accepts: (rule) => typeof rule === "function" && "schemaEnv" in rule,
    refusals: ajvRefusals,
  },
};

// zod: `safeParseAsync`, since through `~standard.validate` an async refine runs twice and a rejection escapes.
async function zodRefusals(rule: unknown, copy: unknown): Promise<readonly InputRuleRefusal[]> {
  const result: unknown = await Reflect.apply(Reflect.get(asObject(rule), "safeParseAsync"), rule, [
    copy,
  ]);

  if (!isPlainObject(result) || result.success === true) return [];

  const error: unknown = result.error;
  const issues: unknown =
    typeof error === "object" && error !== null ? Reflect.get(error, "issues") : [];

  return (Array.isArray(issues) ? issues : []).map((issue: unknown) => {
    const path: unknown = isPlainObject(issue) ? issue.path : [];
    const params: unknown = isPlainObject(issue) ? issue.params : undefined;

    return {
      pointer: pointerOfKeys(Array.isArray(path) ? path : []),
      name: isPlainObject(params) ? params.rule : undefined,
    };
  });
}

// yup: `validate` with `abortEarly: false`, since its standard interface drops the test's name.
async function yupRefusals(rule: unknown, copy: unknown): Promise<readonly InputRuleRefusal[]> {
  try {
    await Reflect.apply(Reflect.get(asObject(rule), "validate"), rule, [
      copy,
      { abortEarly: false },
    ]);

    return [];
  } catch (error) {
    if (!isYupValidationError(error)) throw error;

    const inner: unknown = Reflect.get(error, "inner");
    const errors: unknown[] = Array.isArray(inner) && inner.length > 0 ? inner : [error];

    return errors.map((each) => ({
      pointer: yupPathPointer(objectMember(each, "path")),
      name: objectMember(each, "type"),
    }));
  }
}

// Ajv: the validate function returns a boolean and sets `errors`, or, for a `$async` schema, rejects with a
// `ValidationError` that carries them.
async function ajvRefusals(rule: unknown, copy: unknown): Promise<readonly InputRuleRefusal[]> {
  if (typeof rule !== "function") throw new Error("seampact: an Ajv input rule is not a function");

  const outcome: unknown = Reflect.apply(rule, undefined, [copy]);

  if (!(outcome instanceof Promise)) {
    return outcome === true ? [] : ajvErrorRefusals(Reflect.get(rule, "errors"));
  }

  try {
    await outcome;

    return [];
  } catch (error) {
    if (objectMember(error, "validation") !== true) throw error;

    return ajvErrorRefusals(objectMember(error, "errors"));
  }
}

function ajvErrorRefusals(errors: unknown): readonly InputRuleRefusal[] {
  if (!Array.isArray(errors) || errors.length === 0)
    return [{ pointer: ROOT_POINTER, name: undefined }];

  return errors.map((error: unknown) => {
    const instancePath = objectMember(error, "instancePath");

    return {
      pointer: typeof instancePath === "string" ? instancePath : ROOT_POINTER,
      name: objectMember(error, "keyword"),
    };
  });
}

function isYupValidationError(error: unknown): error is object {
  return (
    objectMember(error, "name") === "ValidationError" && Array.isArray(objectMember(error, "inner"))
  );
}

// A yup path such as `items[0].end` or `["a.b"]` as a JSON pointer; the part root has no path.
const YUP_PATH_SEGMENT = /\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|([^.[\]]+)/g;

/** A yup error path as a JSON pointer, keeping array indices. */
export function yupPathPointer(path: unknown): string {
  if (typeof path !== "string" || path === "") return ROOT_POINTER;

  const keys = [...path.matchAll(YUP_PATH_SEGMENT)].map(
    (match) => match[1]?.replaceAll(/\\(.)/g, "$1") ?? match[2] ?? match[3] ?? "",
  );

  return pointerOfKeys(keys);
}

function pointerOfKeys(keys: readonly unknown[]): string {
  return jsonPointer(keys.map((key) => String(key)));
}

function isObjectWith(value: unknown, member: string): value is object {
  return typeof value === "object" && value !== null && member in value;
}

function asObject(value: unknown): object {
  if (typeof value !== "object" || value === null) {
    throw new Error("seampact: an input rule is not an object");
  }

  return value;
}

function objectMember(value: unknown, member: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, member) : undefined;
}
