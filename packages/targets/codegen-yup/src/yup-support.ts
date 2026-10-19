// The generated module the yup validators share: the unknown keys check of input objects, the multiple-of check, and the Standard Schema
// that validates an operation's request and names each issue by its contract rule, the convention a server
// boundary renders (`code: "custom"` with `params.rule`).
export const YUP_SUPPORT_MODULE = "yup-support";

export const UNKNOWN_KEYS_TEST = "unknownKeysTest";
export const STANDARD_SCHEMA_OF = "standardSchemaOf";
export const IS_MULTIPLE_OF = "isMultipleOf";

// yup writes an error path as `a.b[0]["c.d"]`: a name with a dot is bracketed, an index is `[n]`. The generator
// refuses a name with `"`, `[` or `]`, which would make the path ambiguous, so the split below is exact.
export const YUP_SUPPORT_SOURCE = `import { type Schema, type TestConfig, ValidationError } from "yup";

const UNKNOWN_KEYS_RULE = "unknownKeys";
const PATH_SEGMENT = /\\["([^"]*)"\\]|\\[(\\d+)\\]|([^.[\\]]+)/g;

export interface InputIssue {
readonly message: string;
readonly path: readonly string[];
readonly code: "custom";
readonly params: { readonly rule: string };
}

export type InputResult = { readonly value: unknown } | { readonly issues: readonly InputIssue[] };

export interface InputStandardSchema {
readonly "~standard": {
readonly version: 1;
readonly vendor: "yup";
readonly validate: (value: unknown) => Promise<InputResult>;
};
}

function decimalPlaces(value: number): number {
const [mantissa = "", exponent = "0"] = String(value).split("e");
const fraction = (mantissa.split(".")[1] ?? "").length;

return Math.max(0, fraction - Number(exponent));
}

// A remainder that holds for decimal steps: both numbers are scaled to integers first, since \`3 % 0.1\` is not 0.
export function ${IS_MULTIPLE_OF}(value: number, step: number): boolean {
const scale = 10 ** Math.max(decimalPlaces(value), decimalPlaces(step));

return Math.round(value * scale) % Math.round(step * scale) === 0;
}

function declaredKeys(schema: object): ReadonlySet<string> {
const fields = "fields" in schema ? schema.fields : undefined;

return new Set(typeof fields === "object" && fields !== null ? Object.keys(fields) : []);
}

// An input object refuses every key its schema does not declare, one issue per key.
export const ${UNKNOWN_KEYS_TEST}: TestConfig<unknown> = {
name: UNKNOWN_KEYS_RULE,
test(value, context) {
if (typeof value !== "object" || value === null) return true;

const declared = declaredKeys(context.schema);
const keys = Object.keys(value).filter((key) => !declared.has(key));

if (keys.length === 0) return true;

return context.createError({ message: "Unknown keys: " + keys.join(", "), params: { keys } });
},
};

function pathSegments(path: string | undefined): string[] {
return Array.from((path ?? "").matchAll(PATH_SEGMENT), (match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function issue(error: ValidationError, path: readonly string[], rule: string): InputIssue {
return { message: error.message, path, code: "custom", params: { rule } };
}

function contractRule(type: string | undefined): string {
switch (type) {
case "optionality":
return "required";
case "typeError":
case "nullable":
case "integer":
return "type";
case "min":
return "minItems";
case "max":
return "maxItems";
default:
return type ?? "invalid";
}
}

function issuesOf(error: ValidationError): InputIssue[] {
const path = pathSegments(error.path);

if (error.type === UNKNOWN_KEYS_RULE) {
const keys: unknown = error.params?.keys;

return (Array.isArray(keys) ? keys : []).map((key) => issue(error, [...path, String(key)], UNKNOWN_KEYS_RULE));
}

return [issue(error, path, contractRule(error.type))];
}

// Validates without casting: every leaf schema is strict, so a value of another type is an issue, never converted.
export function ${STANDARD_SCHEMA_OF}(schema: Schema): InputStandardSchema {
return {
"~standard": {
version: 1,
vendor: "yup",
async validate(value) {
try {
return { value: await schema.validate(value, { abortEarly: false }) };
} catch (error) {
if (!ValidationError.isError(error)) throw error;

return { issues: (error.inner.length > 0 ? error.inner : [error]).flatMap(issuesOf) };
}
},
},
};
}
`;
