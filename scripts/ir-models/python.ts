import { splitName } from "@seampact/spec/naming";
import {
  type Definition,
  definitionDoc,
  type Member,
  type NeutralModel,
  type OpenEnumDefinition,
  type StructDefinition,
  type TypeRef,
  type UnionDefinition,
} from "./model.ts";
import { NameCollisionError } from "./names.ts";
import {
  docstringLines,
  PYTHON_INDENT as INDENT,
  PYTHON_LINE_LENGTH,
  type PythonExpression,
  pythonString,
  renderExpression,
} from "./python-printer.ts";
import { type Shape, shapeOfDefinition } from "./shapes.ts";

// The Python emitter (ADR 0010): frozen slotted dataclasses with a generated hydrator from `json.loads` output and
// an encoder back to the same shape, an abstract class per tagged union with an `Unknown` subclass, an open enum as
// a `StrEnum` of its known values beside an `Unknown(raw)` class, and a `type` statement per alias. Attribute names
// are the IR member names in snake case. Unknown members are tolerated and dropped. The helpers the model calls
// live in `seampact.ir.hydration`, written by hand.

export const PYTHON_MODEL_DIRECTORY = "python/ir/src/seampact/ir/model";

const HYDRATION_MODULE = "seampact.ir.hydration";
const SHAPE_MODULE = "seampact.ir.shape";

/** The names the generated definitions module imports: a definition with one of these names would clash. */
export const PYTHON_CLAIMED_NAMES = [
  "ABC",
  "Omitted",
  "FrozenJson",
  "IrModelError",
  "JsonValue",
  "Literal",
  "Mapping",
  "StrEnum",
  "UnknownEnumValue",
  "UnknownVariant",
] as const;

const UNKNOWN_SUFFIX = "Unknown";
const RESERVED_ESCAPE = "_";

// The keywords of Python 3.12 (`keyword.kwlist`); a soft keyword is a valid attribute name.
const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

// The methods and fields the generated classes define beside the members.
const CLAIMED_MEMBER_NAMES = new Set(["from_json", "to_json", "raw"]);

export interface PythonContext {
  model: NeutralModel;
  irVersion: number;
  irRevision: number;
  regenerateCommand: string;
}

/** The Python model files, keyed by repository-relative path. */
export function emitPython(context: PythonContext): Map<string, string> {
  assertClassNamesDistinct(context.model);
  const definitions = new Map(context.model.definitions.map((entry) => [entry.name, entry]));
  const emitter = new PythonEmitter(definitions);
  const header = headerLines(context);

  return new Map([
    [`${PYTHON_MODEL_DIRECTORY}/__init__.py`, emitter.definitionsModule(context.model, header)],
    [`${PYTHON_MODEL_DIRECTORY}/shapes.py`, shapesModule(context.model.definitions, header)],
    [
      `${PYTHON_MODEL_DIRECTORY}/version.py`,
      versionModule(context.irVersion, context.irRevision, header),
    ],
  ]);
}

/** The Python type name of a definition: its IR name, which is never a Python keyword. */
export function pythonTypeName(definition: string): string {
  if (PYTHON_KEYWORDS.has(definition))
    throw new NameCollisionError(
      `${definition}: its Python name is a Python keyword; rename the definition in the IR schema`,
    );

  return definition;
}

/** A member's Python attribute name: its IR name in snake case, `_` appended to a Python keyword (`in_`). */
export function pythonAttributeName(member: string): string {
  const snake = splitName(member).join("_");

  if (snake === "") throw new NameCollisionError(`${member}: the member has no name segment`);

  return PYTHON_KEYWORDS.has(snake) ? `${snake}${RESERVED_ESCAPE}` : snake;
}

function headerLines(context: PythonContext): string[] {
  return [
    `# Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision ${context.irRevision}. Do not edit.`,
    `# Regenerate: ${context.regenerateCommand}`,
  ];
}

function moduleText(header: string[], docstring: string, body: string[]): string {
  const lines = [...header, "", ...docstringLines(docstring, ""), "", ...body];

  while (lines.at(-1) === "") lines.pop();

  return `${lines.join("\n")}\n`;
}

function importLines(module: string, names: Iterable<string>): string[] {
  const sorted = [...names].sort(compareImportNames);
  const single = `from ${module} import ${sorted.join(", ")}`;

  if (single.length <= PYTHON_LINE_LENGTH) return [single];

  return [`from ${module} import (`, ...sorted.map((name) => `${INDENT}${name},`), ")"];
}

// Ruff's isort order: constants, then classes, then functions and variables, each in code-unit order.
function compareImportNames(left: string, right: string): number {
  const rank = (name: string): number => {
    if (/^[A-Z0-9_]+$/.test(name) && /[A-Z]/.test(name)) return 0;

    return /^[A-Z]/.test(name) ? 1 : 2;
  };
  const byRank = rank(left) - rank(right);

  if (byRank !== 0) return byRank;

  return left < right ? -1 : left > right ? 1 : 0;
}

function versionModule(irVersion: number, irRevision: number, header: string[]): string {
  return moduleText(header, "The IR versions this model was generated for (ADR 0005 section 2).", [
    "from typing import Final",
    "",
    `IR_VERSION: Final = ${irVersion}`,
    `IR_REVISION: Final = ${irRevision}`,
  ]);
}

function assertClassNamesDistinct(model: NeutralModel): void {
  const owners = new Map<string, string>(
    PYTHON_CLAIMED_NAMES.map((name) => [name, `the name ${name} the generated module imports`]),
  );
  const claim = (name: string, owner: string): void => {
    const previous = owners.get(name);

    if (previous !== undefined)
      throw new NameCollisionError(`${owner}: its Python name ${name} collides with ${previous}`);
    owners.set(name, owner);
  };

  for (const definition of model.definitions) {
    const name = pythonTypeName(definition.name);

    claim(name, definition.name);

    if (definition.kind === "union" || definition.kind === "openEnum")
      claim(`${name}${UNKNOWN_SUFFIX}`, `${definition.name}'s Unknown class`);
  }
}

/** The member name of each known value: its ADR 0007 segments in upper snake case (`application/json`). */
function enumMembers(definition: OpenEnumDefinition): { member: string; value: string }[] {
  const seen = new Map<string, string>();

  return definition.known.map((value) => {
    const segments = splitName(value);

    if (segments.length === 0)
      throw new NameCollisionError(
        `${definition.name}: the known value ${JSON.stringify(value)} has no name segment`,
      );
    const joined = segments.join("_").toUpperCase();
    const member = /^[0-9]/.test(joined) ? `_${joined}` : joined;
    const previous = seen.get(member);

    if (previous !== undefined) {
      throw new NameCollisionError(
        `${definition.name}: the known values ${JSON.stringify(previous)} and ${JSON.stringify(value)} both give the Python member ${member}`,
      );
    }

    seen.set(member, value);

    return { member, value };
  });
}

function attributeNames(definition: StructDefinition): Map<string, string> {
  const names = new Map<string, string>();
  const owners = new Map<string, string>();

  for (const member of definition.members) {
    const name = pythonAttributeName(member.name);
    const owner =
      owners.get(name) ?? (CLAIMED_MEMBER_NAMES.has(name) ? "a generated method" : undefined);

    if (owner !== undefined)
      throw new NameCollisionError(
        `${definition.name}.${member.name}: its Python name ${name} collides with ${owner}`,
      );
    owners.set(name, `the member ${member.name}`);
    names.set(member.name, name);
  }

  return names;
}

function attributeName(names: Map<string, string>, member: string): string {
  const name = names.get(member);

  if (name === undefined) throw new Error(`${member}: no Python name was computed for it`);

  return name;
}

class PythonEmitter {
  private readonly definitions: Map<string, Definition>;
  private readonly hydration = new Set<string>();
  private readonly typing = new Set<string>();

  constructor(definitions: Map<string, Definition>) {
    this.definitions = definitions;
  }

  definitionsModule(model: NeutralModel, header: string[]): string {
    // A union's base class comes first: its variants subclass it when the module loads.
    const ordered = [
      ...model.definitions.filter((definition) => definition.kind === "union"),
      ...model.definitions.filter((definition) => definition.kind !== "union"),
    ];
    const blocks = ordered.flatMap((definition) => this.blocks(definition));
    const body = blocks.flatMap((block) => ["", "", ...block]);

    const imports = [
      "from __future__ import annotations",
      "",
      ...(this.typing.has("ABC") ? ["from abc import ABC, abstractmethod"] : []),
      "from collections.abc import Mapping",
      "from dataclasses import dataclass, field",
      "from enum import StrEnum",
      `from typing import ${[...this.typing]
        .filter((name) => name !== "ABC")
        .sort(compareImportNames)
        .join(", ")}`,
      "",
      ...importLines(HYDRATION_MODULE, this.hydration),
    ];

    return moduleText(
      header,
      "The IR model (ADR 0010): one class per IR definition, read from and written back to JSON.",
      [...imports, ...body],
    );
  }

  private use(name: string): string {
    this.hydration.add(name);

    return name;
  }

  private blocks(definition: Definition): string[][] {
    switch (definition.kind) {
      case "struct":
        return [this.struct(definition)];
      case "union":
        return this.union(definition);
      case "openEnum":
        return this.openEnum(definition);
      case "alias":
        return [
          this.alias(
            definition.name,
            this.annotation(definition.target),
            definitionDoc(definition),
          ),
        ];
      case "extensionSlot":
        return [
          this.alias(
            definition.name,
            `Mapping[str, Mapping[str, ${this.use("FrozenJson")}]]`,
            definitionDoc(definition),
          ),
        ];
    }
  }

  private definition(name: string): Definition {
    const definition = this.definitions.get(name);

    if (definition === undefined) throw new Error(`${name}: no such definition`);

    return definition;
  }

  /** The resolved definition a type names: an alias is followed to its target. */
  private resolved(type: TypeRef): TypeRef | Definition {
    if (type.kind !== "named") return type;
    const definition = this.definition(type.definition);

    return definition.kind === "alias" ? this.resolved(definition.target) : definition;
  }

  private annotation(type: TypeRef): string {
    switch (type.kind) {
      case "named": {
        const definition = this.definition(type.definition);
        const name = pythonTypeName(definition.name);

        return definition.kind === "openEnum" ? `${name} | ${name}${UNKNOWN_SUFFIX}` : name;
      }

      case "string":
        return "str";
      case "integer":
        return "int";
      case "boolean":
        return "bool";
      case "opaque":
        return this.use("FrozenJson");
      case "array":
        return `tuple[${this.annotation(type.items)}, ...]`;
      case "map":
        return `Mapping[str, ${this.annotation(type.values)}]`;
    }
  }

  /** The expression of a reader: a callable from a decoded JSON value to the model's value. */
  private reader(type: TypeRef, at: string): PythonExpression {
    const resolved = this.resolved(type);
    const location = pythonString(at);

    switch (resolved.kind) {
      case "struct":
      case "union":
        return `${pythonTypeName(resolved.name)}.from_json`;
      case "openEnum": {
        const name = pythonTypeName(resolved.name);

        return {
          call: this.use("open_enum_reader"),
          arguments: [location, name, `${name}${UNKNOWN_SUFFIX}`],
        };
      }

      case "extensionSlot":
        return { call: this.use("extensions_reader"), arguments: [location] };
      case "string":
        return { call: this.use("string_reader"), arguments: [location] };
      case "integer":
        return { call: this.use("integer_reader"), arguments: [location] };
      case "boolean":
        return { call: this.use("boolean_reader"), arguments: [location] };
      case "opaque":
        return { call: this.use("opaque_reader"), arguments: [location] };
      case "array":
        return {
          call: this.use("list_reader"),
          arguments: [location, this.reader(resolved.items, `${at}[]`)],
        };
      case "map":
        return {
          call: this.use("map_reader"),
          arguments: [location, this.reader(resolved.values, `${at}{}`)],
        };
      case "alias":
      case "named":
        throw new Error(`${at}: an alias was not resolved`);
    }
  }

  /** The expression of an encoder: a callable from the model's value to data `json.dumps` writes. */
  private encoder(type: TypeRef): PythonExpression {
    const resolved = this.resolved(type);

    switch (resolved.kind) {
      case "struct":
      case "union":
        return this.use("encode_model");
      case "openEnum":
        return this.use("encode_open_enum");
      case "extensionSlot":
        return this.use("thaw_extensions");
      case "opaque":
        return this.use("thaw");
      case "array":
        return { call: this.use("list_encoder"), arguments: [this.encoder(resolved.items)] };
      case "map":
        return { call: this.use("map_encoder"), arguments: [this.encoder(resolved.values)] };
      default:
        return this.use("encode_plain");
    }
  }

  /** The expression encoding `value`, or `value` itself when it is already plain data. */
  private encoded(type: TypeRef, value: string): PythonExpression {
    const resolved = this.resolved(type);

    switch (resolved.kind) {
      case "struct":
      case "union":
        return `${value}.to_json()`;
      case "openEnum":
        return { call: this.use("encode_open_enum"), arguments: [value] };
      case "extensionSlot":
        return { call: this.use("thaw_extensions"), arguments: [value] };
      case "opaque":
        return { call: this.use("thaw"), arguments: [value] };
      case "array":
        return { call: this.use("encode_list"), arguments: [value, this.encoder(resolved.items)] };
      case "map":
        return { call: this.use("encode_map"), arguments: [value, this.encoder(resolved.values)] };
      default:
        return value;
    }
  }

  /** The statement copying a kept container in `__post_init__`, or undefined for a value that needs none. */
  private copied(member: Member, name: string, owner: string): string[] | undefined {
    const resolved = this.resolved(member.type);
    const property = `self.${name}`;
    const at = pythonString(`${owner}.${member.name}`);
    let copy: PythonExpression;

    switch (resolved.kind) {
      case "array":
        copy = { call: this.use("copy_list"), arguments: [property] };
        break;
      case "map":
        copy = { call: this.use("copy_map"), arguments: [property] };
        break;
      case "opaque":
        copy = { call: this.use("freeze"), arguments: [property, at] };
        break;
      case "extensionSlot":
        copy = { call: this.use("freeze_extensions"), arguments: [property, at] };
        break;
      default:
        return undefined;
    }

    const set = { call: "object.__setattr__", arguments: ["self", pythonString(name), copy] };

    if (member.required) return renderExpression(set, `${INDENT}${INDENT}`, "", "");

    const present =
      resolved.kind === "opaque"
        ? `not isinstance(${property}, ${this.use("Omitted")})`
        : `${property} is not None`;

    return [
      `${INDENT}${INDENT}if ${present}:`,
      ...renderExpression(set, `${INDENT}${INDENT}${INDENT}`, "", ""),
    ];
  }

  /** The `raise` of a model error with `message`, inside an `if` of a method. */
  private raised(message: string): string[] {
    return renderExpression(
      { call: this.use("IrModelError"), arguments: [pythonString(message)] },
      `${INDENT}${INDENT}${INDENT}`,
      "raise ",
      "",
    );
  }

  private alias(name: string, target: string, doc: string | undefined): string[] {
    return [
      `type ${pythonTypeName(name)} = ${target}`,
      ...(doc === undefined ? [] : docstringLines(doc, "")),
    ];
  }

  private classDecorators(): string[] {
    this.typing.add("final");

    return ["@final", "@dataclass(frozen=True, slots=True, kw_only=True)"];
  }

  private struct(definition: StructDefinition): string[] {
    const name = pythonTypeName(definition.name);
    const names = attributeNames(definition);
    const variant = definition.variantOf;
    const doc = definitionDoc(definition);
    const lines = [
      ...this.classDecorators(),
      `class ${name}${variant === undefined ? "" : `(${pythonTypeName(variant.union)})`}:`,
      ...(doc === undefined ? [] : [...docstringLines(doc, INDENT), ""]),
    ];
    const fields = definition.members.flatMap((member) =>
      this.field(definition, member, attributeName(names, member.name)),
    );

    lines.push(...(fields.length === 0 ? [] : [...fields, ""]));
    const copies = definition.members.flatMap(
      (member) => this.copied(member, attributeName(names, member.name), definition.name) ?? [],
    );

    if (copies.length > 0) lines.push(`${INDENT}def __post_init__(self) -> None:`, ...copies, "");

    lines.push(...this.fromJson(definition, names), "", ...this.toJson(definition, names));

    return lines;
  }

  private field(definition: StructDefinition, member: Member, name: string): string[] {
    const variant = definition.variantOf;
    const doc = member.description === undefined ? [] : docstringLines(member.description, INDENT);

    if (variant?.member === member.name) {
      this.typing.add("Literal");
      const value = pythonString(variant.value);

      return [`${INDENT}${name}: Literal[${value}] = field(default=${value}, init=False)`, ...doc];
    }

    const annotation = this.annotation(member.type);

    if (member.required) return [`${INDENT}${name}: ${annotation}`, ...doc];

    if (member.type.kind === "opaque")
      return [
        `${INDENT}${name}: ${annotation} | ${this.use("Omitted")} = ${this.use("OMITTED")}`,
        ...doc,
      ];

    return [`${INDENT}${name}: ${annotation} | None = None`, ...doc];
  }

  private fromJson(definition: StructDefinition, names: Map<string, string>): string[] {
    const name = pythonTypeName(definition.name);
    const variant = definition.variantOf;
    const owner = pythonString(definition.name);
    const members = definition.members.filter((member) => member.name !== variant?.member);
    const read = `${this.use("read_object")}(value, ${owner})`;
    const usesMembers = members.length > 0 || variant !== undefined;
    const lines = [
      `${INDENT}@staticmethod`,
      `${INDENT}def from_json(value: object) -> ${name}:`,
      `${INDENT}${INDENT}${usesMembers ? `members = ${read}` : read}`,
    ];

    if (variant !== undefined) {
      lines.push(
        `${INDENT}${INDENT}${this.use("expect_tag")}(members, ${pythonString(variant.member)}, ${pythonString(variant.value)}, ${owner})`,
      );
    }

    const construct: PythonExpression = {
      call: name,
      arguments: members.map((member) => ({
        keyword: attributeName(names, member.name),
        value: this.memberReader(definition, member),
      })),
    };

    lines.push(...renderExpression(construct, `${INDENT}${INDENT}`, "return ", ""));

    return lines;
  }

  private memberReader(definition: StructDefinition, member: Member): PythonExpression {
    const at = `${definition.name}.${member.name}`;
    const memberName = pythonString(member.name);

    if (!member.required && member.type.kind === "opaque")
      return {
        call: this.use("optional_opaque"),
        arguments: ["members", memberName, pythonString(at)],
      };

    const reader = this.reader(member.type, at);

    if (member.required)
      return {
        call: this.use("required"),
        arguments: ["members", memberName, pythonString(definition.name), reader],
      };

    return { call: this.use("optional"), arguments: ["members", memberName, reader] };
  }

  private toJson(definition: StructDefinition, names: Map<string, string>): string[] {
    const lines = [
      `${INDENT}def to_json(self) -> dict[str, ${this.use("JsonValue")}]:`,
      `${INDENT}${INDENT}json: dict[str, JsonValue] = {}`,
    ];

    for (const member of definition.members) {
      const property = `self.${attributeName(names, member.name)}`;
      const key = `json[${pythonString(member.name)}]`;
      const encoded = this.encoded(member.type, property);

      if (member.required) {
        lines.push(...renderExpression(encoded, `${INDENT}${INDENT}`, `${key} = `, ""));
        continue;
      }

      const present =
        member.type.kind === "opaque"
          ? `not isinstance(${property}, ${this.use("Omitted")})`
          : `${property} is not None`;

      lines.push(
        `${INDENT}${INDENT}if ${present}:`,
        ...renderExpression(encoded, `${INDENT}${INDENT}${INDENT}`, `${key} = `, ""),
      );
    }

    lines.push(`${INDENT}${INDENT}return json`);

    return lines;
  }

  private union(definition: UnionDefinition): string[][] {
    const name = pythonTypeName(definition.name);
    const unknown = `${name}${UNKNOWN_SUFFIX}`;
    const tag = pythonAttributeName(definition.tag);
    const owner = pythonString(definition.name);
    const doc = definitionDoc(definition);
    const knownTags = definition.variants.map((variant) => pythonString(variant.tagValue));
    const cases = definition.variants.flatMap((variant) => [
      `${INDENT}${INDENT}${INDENT}case ${pythonString(variant.tagValue)}:`,
      `${INDENT}${INDENT}${INDENT}${INDENT}return ${pythonTypeName(variant.definition)}.from_json(members)`,
    ]);

    this.typing.add("ABC");
    const base = [
      `class ${name}(ABC):`,
      ...(doc === undefined ? [] : [...docstringLines(doc, INDENT), ""]),
      `${INDENT}__slots__ = ()`,
      "",
      `${INDENT}${tag}: str`,
      ...docstringLines(`The tag member '${definition.tag}': it picks the variant.`, INDENT),
      "",
      `${INDENT}@staticmethod`,
      `${INDENT}def from_json(value: object) -> ${name}:`,
      `${INDENT}${INDENT}members = ${this.use("read_object")}(value, ${owner})`,
      `${INDENT}${INDENT}tag = ${this.use("union_tag")}(members, ${pythonString(definition.tag)}, ${owner})`,
      `${INDENT}${INDENT}match tag:`,
      ...cases,
      `${INDENT}${INDENT}${INDENT}case _:`,
      ...renderExpression(
        {
          call: unknown,
          arguments: [
            { keyword: tag, value: "tag" },
            {
              keyword: "raw",
              value: { call: this.use("freeze_object"), arguments: ["members", owner] },
            },
          ],
        },
        `${INDENT}${INDENT}${INDENT}${INDENT}`,
        "return ",
        "",
      ),
      "",
      `${INDENT}@abstractmethod`,
      `${INDENT}def to_json(self) -> dict[str, ${this.use("JsonValue")}]: ...`,
    ];

    const unknownOwner = pythonString(`${unknown}.raw`);
    const unknownClass = [
      ...this.classDecorators(),
      `class ${unknown}(${name}, ${this.use("UnknownVariant")}):`,
      ...docstringLines(
        `A variant of ${definition.name} this IR revision does not know, kept raw; its tag is the raw object's.`,
        INDENT,
      ),
      "",
      `${INDENT}${tag}: str`,
      `${INDENT}raw: Mapping[str, ${this.use("FrozenJson")}]`,
      "",
      `${INDENT}def __post_init__(self) -> None:`,
      ...renderExpression({ tuple: knownTags }, `${INDENT}${INDENT}`, `if self.${tag} in `, ":"),
      ...this.raised(`${unknown}: the ${definition.tag} is a known one`),
      `${INDENT}${INDENT}if self.raw.get(${pythonString(definition.tag)}) != self.${tag}:`,
      ...this.raised(`${unknown}: raw does not carry the ${definition.tag}`),
      ...renderExpression(
        {
          call: "object.__setattr__",
          arguments: [
            "self",
            '"raw"',
            { call: this.use("freeze_object"), arguments: ["self.raw", unknownOwner] },
          ],
        },
        `${INDENT}${INDENT}`,
        "",
        "",
      ),
      "",
      `${INDENT}def to_json(self) -> dict[str, JsonValue]:`,
      `${INDENT}${INDENT}return ${this.use("thaw_object")}(self.raw)`,
    ];

    return [base, unknownClass];
  }

  private openEnum(definition: OpenEnumDefinition): string[][] {
    const name = pythonTypeName(definition.name);
    const unknown = `${name}${UNKNOWN_SUFFIX}`;
    const doc = definitionDoc(definition);
    const known = [
      `class ${name}(StrEnum):`,
      ...(doc === undefined ? [] : [...docstringLines(doc, INDENT), ""]),
      ...enumMembers(definition).map(
        ({ member, value }) => `${INDENT}${member} = ${pythonString(value)}`,
      ),
    ];
    const unknownClass = [
      "@final",
      "@dataclass(frozen=True, slots=True)",
      `class ${unknown}(${this.use("UnknownEnumValue")}):`,
      ...docstringLines(
        `A value of ${definition.name} this IR revision does not know, kept raw.`,
        INDENT,
      ),
      "",
      `${INDENT}def __post_init__(self) -> None:`,
      `${INDENT}${INDENT}if self.raw in ${name}:`,
      ...this.raised(`${unknown}: the value is a known one`),
    ];

    this.typing.add("final");

    return [known, unknownClass];
  }
}

function shapeExpression(shape: Shape): PythonExpression {
  switch (shape.kind) {
    case "named":
      return { call: "NamedShape", arguments: [pythonString(shape.definition)] };
    case "struct":
      return {
        call: "StructShape",
        arguments: [
          {
            call: "MappingProxyType",
            arguments: [
              {
                dict: shape.members.map((member) => [
                  pythonString(member.name),
                  shapeExpression(member.shape),
                ]),
              },
            ],
          },
        ],
      };
    case "union":
      return {
        call: "UnionShape",
        arguments: [
          pythonString(shape.tag),
          shape.mustAct ? "True" : "False",
          {
            call: "MappingProxyType",
            arguments: [
              {
                dict: shape.variants.map((variant) => [
                  pythonString(variant.tagValue),
                  pythonString(variant.definition),
                ]),
              },
            ],
          },
        ],
      };
    case "openEnum":
      return {
        call: "OpenEnumShape",
        arguments: [{ tuple: shape.known.map(pythonString) }, shape.mustAct ? "True" : "False"],
      };
    case "items":
      return { call: "ItemsShape", arguments: [shapeExpression(shape.of)] };
    case "values":
      return { call: "ValuesShape", arguments: [shapeExpression(shape.of)] };
  }
}

const SHAPE_CLASSES = [
  "ItemsShape",
  "NamedShape",
  "OpenEnumShape",
  "Shape",
  "StructShape",
  "UnionShape",
  "ValuesShape",
];

/** The shape table: every definition that holds a walked member, a union or an open enum. */
function shapesModule(definitions: readonly Definition[], header: string[]): string {
  const entries: [string, PythonExpression][] = definitions.flatMap((definition) => {
    const shape = shapeOfDefinition(definition);

    return shape === undefined ? [] : [[pythonString(definition.name), shapeExpression(shape)]];
  });
  const table = renderExpression({ dict: entries }, "", "_SHAPES: Final[dict[str, Shape]] = ", "");

  return moduleText(
    header,
    "The shape of every IR definition the must-act walk enters, by schema name.",
    [
      "from collections.abc import Mapping",
      "from types import MappingProxyType",
      "from typing import Final",
      "",
      ...importLines(SHAPE_MODULE, SHAPE_CLASSES),
      "",
      ...table,
      "",
      "SHAPES: Final[Mapping[str, Shape]] = MappingProxyType(_SHAPES)",
    ],
  );
}
