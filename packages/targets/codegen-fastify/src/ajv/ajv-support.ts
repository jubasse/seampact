import { UUID_LAYOUT, WIRE_CHECKS_MODULE } from "@seampact/codegen-core/validators";

// The generated module the Ajv validators share: the one boundary-owned Ajv instance, and the Standard Schema that
// validates without conversion, keeps the declared keys only and names each issue by its contract rule, the
// convention a server boundary renders (`code: "custom"` with `params.rule`, `unrecognized_keys` with `keys`).
export const AJV_SUPPORT_MODULE = "ajv-support";

export const AJV_STANDARD_SCHEMA = "ajvStandardSchema";

export const AJV_IMPORT = `import { Ajv2020, type ErrorObject, type SchemaObject } from "ajv/dist/2020.js";`;

// The Ajv instance is the boundary's: the app's Fastify options (coercion, removal of extra keys, defaults) never
// reach it. Formats come from the generated checks, never from a library of formats; lengths count code points
// (Ajv's own count); `ownProperties` ignores inherited members.
export const AJV_SUPPORT_SOURCE = `${AJV_IMPORT}
import { isDateTime } from "./${WIRE_CHECKS_MODULE}.js";

const UNKNOWN_KEYS_CODE = "unrecognized_keys";
const FALLBACK_RULE = "invalid";
const UUID_FORMAT = new RegExp(${JSON.stringify(UUID_LAYOUT)});

// Ajv keyword to contract rule: the same name, except \`not\` (a null where a value is required), a type.
const RULE_OF_KEYWORD: ReadonlyMap<string, string> = new Map([
["type", "type"],
["not", "type"],
["required", "required"],
["enum", "enum"],
["format", "format"],
["pattern", "pattern"],
["minLength", "minLength"],
["maxLength", "maxLength"],
["minimum", "minimum"],
["maximum", "maximum"],
["exclusiveMinimum", "exclusiveMinimum"],
["exclusiveMaximum", "exclusiveMaximum"],
["multipleOf", "multipleOf"],
["minItems", "minItems"],
["maxItems", "maxItems"],
]);

const ajv = new Ajv2020({
allErrors: true,
coerceTypes: false,
removeAdditional: false,
useDefaults: false,
strict: true,
unicodeRegExp: true,
ownProperties: true,
multipleOfPrecision: 12,
formats: { uuid: UUID_FORMAT, "date-time": isDateTime },
});

export interface InputIssue {
readonly message: string;
readonly path: readonly string[];
readonly code: "custom" | typeof UNKNOWN_KEYS_CODE;
readonly params?: { readonly rule: string };
readonly keys?: readonly string[];
}

export type InputResult = { readonly value: unknown } | { readonly issues: readonly InputIssue[] };

export interface InputStandardSchema {
readonly "~standard": {
readonly version: 1;
readonly vendor: "ajv";
readonly validate: (value: unknown) => InputResult;
};
}

function isRecord(value: unknown): value is Record<string, unknown> {
return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A copy holding the declared keys only, so an undeclared key never reaches the handler or the client.
function declaredValue(schema: unknown, value: unknown): unknown {
if (!isRecord(schema)) return value;

if (Array.isArray(value) && isRecord(schema.items)) {
return value.map((item) => declaredValue(schema.items, item));
}

if (!isRecord(value) || !isRecord(schema.properties)) return value;

const properties = schema.properties;

return Object.fromEntries(
Object.keys(properties)
.filter((key) => Object.hasOwn(value, key))
.map((key) => [key, declaredValue(properties[key], value[key])]),
);
}

function pathOf(instancePath: string): string[] {
if (instancePath === "") return [];

return instancePath.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function issueOf(error: ErrorObject): InputIssue {
const path = pathOf(error.instancePath);

if (error.keyword === "additionalProperties") {
return {
message: error.message ?? "Unknown key.",
path,
code: UNKNOWN_KEYS_CODE,
keys: [String(Reflect.get(error.params, "additionalProperty"))],
};
}

const rule = RULE_OF_KEYWORD.get(error.keyword) ?? FALLBACK_RULE;
const missing = error.keyword === "required" ? [String(Reflect.get(error.params, "missingProperty"))] : [];

return { message: error.message ?? rule, path: [...path, ...missing], code: "custom", params: { rule } };
}

// A value of the wrong type reports its type alone: the other rules of Ajv's keywords read a value of the right type.
function issuesOf(errors: readonly ErrorObject[]): InputIssue[] {
const typeFailures = new Set(errors.filter((error) => error.keyword === "type").map((error) => error.instancePath));

return errors
.filter((error) => error.keyword === "type" || !typeFailures.has(error.instancePath))
.map(issueOf);
}

// Compiled once, when the module loads.
export function ${AJV_STANDARD_SCHEMA}(schema: SchemaObject): InputStandardSchema {
const validate = ajv.compile(schema);

return {
"~standard": {
version: 1,
vendor: "ajv",
validate(value) {
if (validate(value)) return { value: declaredValue(schema, value) };

const issues = issuesOf(validate.errors ?? []);

if (issues.length === 0) {
return { issues: [{ message: "Invalid value.", path: [], code: "custom", params: { rule: FALLBACK_RULE } }] };
}

return { issues };
},
},
};
}
`;
