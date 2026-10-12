// The schema language of ADR 0003, in every schema position (schema.schema.json).

import {
  A3,
  conflict,
  type JsonSchema,
  kw,
  list,
  map,
  object,
  ref,
  req,
  str,
  stringOr,
  when,
} from "../dsl.js";
import { REFUSED_SCHEMA_KEYWORDS, schemaKeyword } from "../keywords.js";
import { MARKERS } from "../markers.js";
import { KEYS, PATH, POINTER } from "./common.js";

const S1 = A3(1);

// A refused keyword: a property that never validates, its reason in the description.
function refusedProps(): Record<string, JsonSchema> {
  return Object.fromEntries(
    REFUSED_SCHEMA_KEYWORDS.map((k) => [
      k.keyword,
      {
        title: MARKERS.refused,
        description: `Refused (${k.section}): ${k.reason}. Fix: ${k.fix}.`,
        $comment: k.section,
        not: {},
      },
    ]),
  );
}

// A refused value form of a kept keyword (`additionalProperties: false`, `type: [string, 'null']`).
function refusedForm(keyword: string): JsonSchema {
  const form = schemaKeyword(keyword)?.refusedForm;
  if (form === undefined) throw new Error(`no refused form for ${keyword}`);
  return {
    title: MARKERS.refusedForm,
    description: `Refused (${A3(1)}): ${form.reason}. Fix: ${form.fix}.`,
    not: {},
  };
}

const annotations = (): Record<string, JsonSchema> => ({
  title: kw(S1, str(), "Docs: the schema's title."),
  description: kw(S1, ref("common", "description")),
  deprecated: kw(S1, { type: "boolean" }),
  default: kw(
    A3(10),
    {},
    "On an optional input property or query field only (ADR 0003 section 10).",
  ),
  examples: kw(A3(11), list({}), "Values parsed against the schema at compile time."),
});

const marks = (): Record<string, JsonSchema> => ({
  nullable: kw(A3(5), { type: "boolean" }, "The value may be JSON null (ADR 0003 section 5)."),
  sensitive: kw(A3(6), { type: "boolean" }, "The value is secret (ADR 0003 section 6)."),
  codeName: kw(
    A3(6),
    str({ minLength: 1 }),
    "The identifier generated code uses for the property.",
  ),
  restrictedTo: kw(A3(6), ref("schema", "restrictedTo")),
  discriminator: kw(A3(3), ref("schema", "discriminator")),
  typeName: kw(A3(6), str({ minLength: 1 }), "The value the $resource slot writes."),
  unknownKeys: kw(A3(4), ref("common", "unknownKeysPolicy")),
  lint: kw(A3(6), ref("common", "lintAllow")),
});

// A derived object's own annotations: those of any schema but `default` (ADR 0003 section 10
// places a default on a property, not on an object).
const annotationsOfDerived = (): Record<string, JsonSchema> => {
  const { default: _default, ...rest } = annotations();
  return rest;
};

const integerBound = (): JsonSchema => ({ type: "integer", minimum: 0 });

function plainProps(): Record<string, JsonSchema> {
  return {
    type: kw(S1, {
      ...when(
        { anyOf: [{ type: "array" }, { type: "null" }, { const: "null" }] },
        refusedForm("type"),
        { enum: ["string", "integer", "number", "boolean", "object", "array"] },
      ),
    }),
    enum: kw(A3(7), {
      ...when(
        { type: "array" },
        refusedForm("enum"),
        stringOr(
          ref("common", "schemaName"),
          object({
            description: "A narrowing of a catalogue enum to a strict subset (ADR 0003 section 7).",
            props: {
              narrow: kw(A3(7), ref("common", "schemaName")),
              to: kw(A3(7), list(str(), { minItems: 1 })),
              reason: kw(A3(7), str(), "Optional docs: why the use narrows the enum."),
            },
            required: ["narrow", "to"],
          }),
        ),
      ),
    }),
    allOf: kw(
      S1,
      list(ref("schema", "schema"), { minItems: 1 }),
      "Object schemas, merged into one.",
    ),
    oneOf: kw(
      A3(3),
      map({
        keys: null,
        keyDescription: "a union tag",
        values: ref("schema", "schema"),
      }),
      "A mapping from tag value to variant (ADR 0003 section 3).",
    ),
    items: kw(S1, ref("schema", "schema")),
    properties: kw(
      S1,
      map({ keys: null, keyDescription: "a property name", values: ref("schema", "schema") }),
    ),
    additionalProperties: kw(S1, {
      ...when({ type: "boolean" }, refusedForm("additionalProperties"), ref("schema", "schema")),
    }),
    propertyNames: kw(S1, ref("schema", "schema")),
    multipleOf: kw(S1, { type: "number", exclusiveMinimum: 0 }),
    maximum: kw(S1, { type: "number" }),
    exclusiveMaximum: kw(S1, { type: "number" }),
    minimum: kw(S1, { type: "number" }),
    exclusiveMinimum: kw(S1, { type: "number" }),
    maxLength: kw(S1, integerBound()),
    minLength: kw(S1, integerBound()),
    pattern: kw(A3(9), str(), "A portable regular expression (ADR 0003 section 9)."),
    maxItems: kw(S1, integerBound()),
    minItems: kw(S1, integerBound()),
    required: kw(A3(5), list(str())),
    format: kw(
      A3(8),
      { type: "string", pattern: `^${KEYS.scalarName}$` },
      "A portable format (uuid, date-time, date, int64, decimal, email, uri, uri-reference) or a named format of the 'scalars' catalogue.",
    ),
    contentMediaType: kw(S1, { enum: ["application/json"] }),
    contentSchema: kw(S1, ref("schema", "schema")),
    opaque: kw(
      A3(2),
      ref("common", "reason"),
      "Any JSON value, not checked here, with the reason (ADR 0003 section 2).",
    ),
    file: kw(
      A3(2),
      object({
        props: {
          media: kw(A3(2), list(str({ minLength: 1 }), { minItems: 1 })),
          maxSize: kw(A3(2), ref("common", "size")),
        },
      }),
      "A file: a multipart field or a download (ADR 0003 section 2).",
    ),
  };
}

const derivation = (): JsonSchema =>
  object({
    props: {
      from: kw(A3(2), ref("schema", "reference")),
      fields: kw(A3(2), list(str(), { minItems: 1 })),
    },
    required: ["from", "fields"],
  });

export function schemaDefs(): Record<string, JsonSchema> {
  return {
    schema: {
      title: "schema",
      description:
        "A schema (ADR 0003): a schema name, a file path, or a mapping in the schema language.",
      ...stringOr(ref("schema", "reference"), ref("schema", "mapping")),
    },
    reference: {
      title: MARKERS.schemaReference,
      description:
        "A schema name (Task) or a file (./schemas/task.yaml#/Task) (ADR 0002 section 2).",
      type: "string",
      pattern: `^(?:${KEYS.schemaName}|${PATH}(?:${POINTER})?)$`,
    },
    mapping: {
      type: "object",
      ...when(req("$ref"), ref("schema", "referenceMapping"), {
        ...when(req("pick"), ref("schema", "derived"), {
          ...when(req("omit"), ref("schema", "derived"), ref("schema", "plain")),
        }),
      }),
    },
    plain: object({
      extensions: true,
      props: { ...plainProps(), ...annotations(), ...marks(), ...refusedProps() },
    }),
    // ADR 0003 section 6: beside `$ref`, only the marks and the annotations.
    referenceMapping: object({
      extensions: true,
      props: {
        $ref: kw(A3(1), ref("schema", "reference")),
        ...annotations(),
        ...marks(),
        ...refusedProps(),
      },
    }),
    // ADR 0003 section 2: `pick` and `omit`.
    derived: object({
      extensions: true,
      props: {
        pick: kw(A3(2), derivation(), "Keeps the listed properties of 'from', in that order."),
        omit: kw(A3(2), derivation(), "Keeps the other properties of 'from', in its order."),
        required: kw(A3(2), list(str())),
        properties: kw(
          A3(2),
          map({ keys: null, keyDescription: "a property name", values: ref("schema", "overlay") }),
          "Overlays of kept properties.",
        ),
        ...annotationsOfDerived(),
        nullable: kw(
          A3(5),
          { type: "boolean" },
          "The value may be JSON null (ADR 0003 section 5).",
        ),
        typeName: kw(A3(6), str({ minLength: 1 })),
        unknownKeys: kw(A3(4), ref("common", "unknownKeysPolicy")),
        lint: kw(A3(6), ref("common", "lintAllow")),
        ...refusedProps(),
      },
      rules: [
        {
          ...when(req("pick"), {
            properties: { omit: conflict("Write 'pick' or 'omit', not both.") },
          }),
        },
      ],
    }),
    // ADR 0003 section 2: what an overlay of a kept property may set.
    overlay: object({
      props: {
        nullable: kw(A3(2), { type: "boolean" }),
        default: kw(A3(2), {}),
        restrictedTo: kw(A3(2), ref("schema", "restrictedTo")),
        title: kw(A3(2), str()),
        description: kw(A3(2), ref("common", "description")),
        deprecated: kw(A3(2), { type: "boolean" }),
        examples: kw(A3(2), list({})),
        ...refusedProps(),
      },
    }),
    restrictedTo: {
      description: "A right name, or { right, params, input } (ADR 0003 section 6).",
      ...stringOr(
        ref("common", "rightName"),
        object({
          props: {
            right: kw(A3(6), ref("common", "rightName")),
            params: kw(A3(6), { type: "object" }),
            input: kw(A3(6), { enum: ["reject", "strip"] }),
          },
          required: ["right"],
        }),
      ),
    },
    discriminator: {
      description: "The tag property, or { from: header.<Name> } (ADR 0003 section 3).",
      ...stringOr(
        str({ minLength: 1 }),
        object({
          props: { from: kw(A3(3), ref("common", "discriminatorSource")) },
          required: ["from"],
        }),
      ),
    },
  };
}
