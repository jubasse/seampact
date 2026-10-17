import { identifier, isReserved, splitName } from "@seampact/spec/naming";
import type {
  Definition,
  Member,
  NeutralModel,
  OpenEnumDefinition,
  StructDefinition,
  TypeRef,
  UnionDefinition,
} from "./model.ts";
import { type DefinitionNames, NameCollisionError } from "./names.ts";
import { PHP_SUPPORT_FILES } from "./php-support.ts";
import { type Shape, shapeOfDefinition } from "./shapes.ts";

// The PHP emitter (ADR 0010): readonly classes with a generated hydrator from `json_decode` output (objects as
// `stdClass`) and a typed encoder back to the same shape, an abstract class per tagged union with an `Unknown`
// subclass, an open enum as a value class of its known constants, and a `@phpstan-type` per alias. No runtime
// dependency. Unknown members are tolerated and dropped: the hydrator reads the members it knows.

export const PHP_NAMESPACE = "Seampact\\Ir\\Model";
export const PHP_MODEL_DIRECTORY = "php/ir/src/Model";

/** The classes the generated files define beside the definitions: a definition with one of these names would clash. */
export const PHP_CLAIMED_NAMES = [
  "IrHydration",
  "IrModelException",
  "IrModelVersion",
  "IrOpaque",
  "IrShape",
  "IrShapes",
  "IrTypes",
] as const;

const UNKNOWN_SUFFIX = "Unknown";
const RESERVED_ESCAPE = "_";
const INDENT = "    ";

export interface PhpContext {
  model: NeutralModel;
  names: readonly DefinitionNames[];
  irVersion: number;
  irRevision: number;
  regenerateCommand: string;
}

/** The PHP model files, keyed by repository-relative path. */
export function emitPhp(context: PhpContext): Map<string, string> {
  const typeNames = new Map(context.names.map((entry) => [entry.definition, entry.names.php]));
  const definitions = new Map(context.model.definitions.map((entry) => [entry.name, entry]));
  assertClassNamesDistinct(context.model, typeNames);
  const emitter = new PhpEmitter(definitions, typeNames);

  const header = headerLines(context);
  const files = new Map<string, string>();
  for (const definition of context.model.definitions) {
    for (const [className, body] of emitter.classes(definition)) {
      files.set(`${PHP_MODEL_DIRECTORY}/${className}.php`, fileText(header, body));
    }
  }

  files.set(
    `${PHP_MODEL_DIRECTORY}/IrTypes.php`,
    fileText(header, emitter.typesClass(context.model)),
  );
  files.set(
    `${PHP_MODEL_DIRECTORY}/IrShapes.php`,
    fileText(header, shapesClass(context.model.definitions)),
  );
  files.set(
    `${PHP_MODEL_DIRECTORY}/IrModelVersion.php`,
    fileText(header, versionClass(context.irVersion, context.irRevision)),
  );
  for (const [className, body] of PHP_SUPPORT_FILES) {
    files.set(`${PHP_MODEL_DIRECTORY}/${className}.php`, fileText(header, body.split("\n")));
  }
  return files;
}

function headerLines(context: PhpContext): string[] {
  return [
    `// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision ${context.irRevision}. Do not edit.`,
    `// Regenerate: ${context.regenerateCommand}`,
  ];
}

function fileText(header: string[], body: string[]): string {
  const lines = [
    "<?php",
    "",
    ...header,
    "",
    "declare(strict_types=1);",
    "",
    `namespace ${PHP_NAMESPACE};`,
    "",
    ...body,
  ];
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function versionClass(irVersion: number, irRevision: number): string[] {
  return [
    "/** The IR versions this model was generated for (ADR 0005 section 2). */",
    "final class IrModelVersion",
    "{",
    `${INDENT}public const IR_VERSION = ${irVersion};`,
    `${INDENT}public const IR_REVISION = ${irRevision};`,
    "}",
  ];
}

/** A PHP single-quoted string literal. */
function phpString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function docLine(description: string | undefined, indent: string): string[] {
  if (description === undefined) return [];
  return [`${indent}/** ${neutralisedComment(description)} */`];
}

function neutralisedComment(text: string): string {
  return text.replaceAll("*/", "*&#47;");
}

function definitionDoc(definition: Definition): string | undefined {
  if (!definition.mustAct) return definition.description;
  const unknown = definition.kind === "union" ? "an unknown tag" : "an unknown value";
  const rule = `Must act: ${unknown} makes the IR invalid for every reader.`;
  return definition.description === undefined ? rule : `${definition.description} ${rule}`;
}

/** A member's PHP property name: its IR name, escaped when PHP reserves it (`this` becomes `this_`). */
function propertyName(member: string): string {
  return isReserved(member, "php", "member") ? `${member}${RESERVED_ESCAPE}` : member;
}

function assertClassNamesDistinct(model: NeutralModel, typeNames: Map<string, string>): void {
  // PHP class names are case-insensitive.
  const owners = new Map<string, string>(
    PHP_CLAIMED_NAMES.map((name) => [
      name.toLowerCase(),
      `the class ${name} the generated files use`,
    ]),
  );
  const claim = (name: string, owner: string): void => {
    const previous = owners.get(name.toLowerCase());
    if (previous !== undefined)
      throw new NameCollisionError(`${owner}: its PHP name ${name} collides with ${previous}`);
    owners.set(name.toLowerCase(), owner);
  };

  for (const definition of model.definitions) {
    if (definition.kind === "alias" || definition.kind === "extensionSlot") continue;
    const name = phpTypeName(typeNames, definition.name);
    claim(name, definition.name);
    if (definition.kind === "union")
      claim(`${name}${UNKNOWN_SUFFIX}`, `${definition.name}'s Unknown subclass`);
  }
}

function phpTypeName(typeNames: Map<string, string>, definition: string): string {
  const name = typeNames.get(definition);
  if (name === undefined) throw new Error(`${definition}: no PHP name was computed for it`);
  return name;
}

const HYDRATION = "IrHydration";

class PhpEmitter {
  private readonly definitions: Map<string, Definition>;
  private readonly typeNames: Map<string, string>;

  constructor(definitions: Map<string, Definition>, typeNames: Map<string, string>) {
    this.definitions = definitions;
    this.typeNames = typeNames;
  }

  /** The classes of a definition: the class name and its body lines. */
  classes(definition: Definition): [string, string[]][] {
    switch (definition.kind) {
      case "struct":
        return [[this.className(definition.name), this.struct(definition)]];
      case "union":
        return this.union(definition);
      case "openEnum":
        return [[this.className(definition.name), this.openEnum(definition)]];
      case "alias":
      case "extensionSlot":
        return [];
    }
  }

  private className(definition: string): string {
    return phpTypeName(this.typeNames, definition);
  }

  private definition(name: string): Definition {
    const definition = this.definitions.get(name);
    if (definition === undefined) throw new Error(`${name}: no such definition`);
    return definition;
  }

  /** The native PHP type; an alias is its target. */
  private native(type: TypeRef): string {
    switch (type.kind) {
      case "named": {
        const definition = this.definition(type.definition);
        if (definition.kind === "alias") return this.native(definition.target);
        if (definition.kind === "extensionSlot") return "\\stdClass";
        return this.className(definition.name);
      }
      case "string":
        return "string";
      case "integer":
        return "int";
      case "boolean":
        return "bool";
      case "opaque":
        return "mixed";
      case "array":
      case "map":
        return "array";
    }
  }

  /** The type for a doc comment: a list or map says its item type. `keepAlias` names an alias instead of resolving it. */
  private doc(type: TypeRef, keepAlias = false): string {
    switch (type.kind) {
      case "named": {
        const definition = this.definition(type.definition);
        if (definition.kind === "alias" && keepAlias) return definition.name;
        if (definition.kind === "alias") return this.doc(definition.target);
        return this.native(type);
      }
      case "array":
        return `list<${this.doc(type.items)}>`;
      case "map":
        return `array<int|string, ${this.doc(type.values)}>`;
      default:
        return this.native(type);
    }
  }

  private hydrate(type: TypeRef, value: string, at: string): string {
    switch (type.kind) {
      case "named": {
        const definition = this.definition(type.definition);
        if (definition.kind === "alias") return this.hydrate(definition.target, value, at);
        if (definition.kind === "extensionSlot")
          return `${HYDRATION}::copyObject(${HYDRATION}::object(${value}, ${phpString(at)}))`;
        return `${this.className(definition.name)}::fromJson(${value})`;
      }
      case "string":
        return `${HYDRATION}::string(${value}, ${phpString(at)})`;
      case "integer":
        return `${HYDRATION}::integer(${value}, ${phpString(at)})`;
      case "boolean":
        return `${HYDRATION}::boolean(${value}, ${phpString(at)})`;
      case "opaque":
        return `${HYDRATION}::copy(${value})`;
      case "array":
        return `${HYDRATION}::listOf(${value}, ${phpString(at)}, ${this.hydrator(type.items, `${at}[]`)})`;
      case "map":
        return `${HYDRATION}::mapOf(${value}, ${phpString(at)}, ${this.hydrator(type.values, `${at}{}`)})`;
    }
  }

  private hydrator(type: TypeRef, at: string): string {
    return `static fn (mixed $item): ${this.native(type)} => ${this.hydrate(type, "$item", at)}`;
  }

  /** The expression writing a value back as JSON-encodable data, or undefined when the value is already that. */
  private encode(type: TypeRef, value: string): string | undefined {
    switch (type.kind) {
      case "named": {
        const definition = this.definition(type.definition);
        if (definition.kind === "alias") return this.encode(definition.target, value);
        if (definition.kind === "extensionSlot") return `${HYDRATION}::copy(${value})`;
        return `${value}->toJson()`;
      }
      case "opaque":
        return `${HYDRATION}::copy(${value})`;
      case "array": {
        const item = this.encode(type.items, "$item");
        if (item === undefined) return undefined;
        return `${HYDRATION}::encodeList(${value}, static fn (${this.native(type.items)} $item): mixed => ${item})`;
      }
      case "map": {
        const item = this.encode(type.values, "$item");
        const encoder =
          item === undefined
            ? ""
            : `, static fn (${this.native(type.values)} $item): mixed => ${item}`;
        return `${HYDRATION}::encodeMap(${value}${encoder})`;
      }
      default:
        return undefined;
    }
  }

  private isOptionalOpaque(member: Member): boolean {
    return !member.required && member.type.kind === "opaque";
  }

  private memberNative(member: Member): string {
    if (this.isOptionalOpaque(member)) return "?IrOpaque";
    const native = this.native(member.type);
    return member.required || native === "mixed" ? native : `?${native}`;
  }

  private memberDoc(member: Member): string {
    if (this.isOptionalOpaque(member)) return "IrOpaque|null";
    const doc = this.doc(member.type);
    return member.required || doc === "mixed" ? doc : `${doc}|null`;
  }

  private struct(definition: StructDefinition): string[] {
    const name = this.className(definition.name);
    const variant = definition.variantOf;
    const tagMember = variant?.member;
    const parameters = definition.members.filter((member) => member.name !== tagMember);
    const ordered = [
      ...parameters.filter((member) => member.required),
      ...parameters.filter((member) => !member.required),
    ];

    const lines = [
      ...docLine(definitionDoc(definition), ""),
      `final readonly class ${name}${variant === undefined ? "" : ` extends ${this.className(variant.union)}`}`,
      "{",
    ];
    if (variant !== undefined) {
      lines.push(
        `${INDENT}/** The tag member '${variant.member}': fixed to ${phpString(variant.value)}. */`,
        `${INDENT}public string $${propertyName(variant.member)};`,
        "",
      );
    }
    lines.push(...this.constructorLines(ordered, variant));
    lines.push("", ...this.fromJson(definition, ordered));
    lines.push("", ...this.toJson(definition));
    if (variant !== undefined) {
      lines.push(
        "",
        `${INDENT}public function tag(): string`,
        `${INDENT}{`,
        `${INDENT}${INDENT}return $this->${propertyName(variant.member)};`,
        `${INDENT}}`,
      );
    }
    lines.push("}", "");
    return lines;
  }

  private constructorLines(members: Member[], variant: StructDefinition["variantOf"]): string[] {
    const docs = members.map((member) => {
      const description =
        member.description === undefined ? "" : ` ${neutralisedComment(member.description)}`;
      return `${INDENT} * @param ${this.memberDoc(member)} $${propertyName(member.name)}${description}`;
    });
    const parameters = members.map((member) => {
      const optional = member.required ? "" : " = null";
      return `${INDENT}${INDENT}public ${this.memberNative(member)} $${propertyName(member.name)}${optional},`;
    });

    const body =
      variant === undefined
        ? []
        : [
            `${INDENT}${INDENT}$this->${propertyName(variant.member)} = ${phpString(variant.value)};`,
          ];
    return [
      ...(docs.length === 0 ? [] : [`${INDENT}/**`, ...docs, `${INDENT} */`]),
      `${INDENT}public function __construct(`,
      ...parameters,
      `${INDENT}) {`,
      ...body,
      `${INDENT}}`,
    ];
  }

  private fromJson(definition: StructDefinition, members: Member[]): string[] {
    const variant = definition.variantOf;
    const lines = [
      `${INDENT}public static function fromJson(mixed $value): self`,
      `${INDENT}{`,
      `${INDENT}${INDENT}$members = ${HYDRATION}::object($value, ${phpString(definition.name)});`,
    ];
    if (variant !== undefined) {
      lines.push(
        `${INDENT}${INDENT}${HYDRATION}::tag($members, ${phpString(variant.member)}, ${phpString(variant.value)}, ${phpString(definition.name)});`,
      );
    }
    lines.push("", `${INDENT}${INDENT}return new self(`);
    for (const member of members) {
      lines.push(
        `${INDENT}${INDENT}${INDENT}${propertyName(member.name)}: ${this.memberHydration(definition, member)},`,
      );
    }
    lines.push(`${INDENT}${INDENT});`, `${INDENT}}`);
    return lines;
  }

  private memberHydration(definition: StructDefinition, member: Member): string {
    const at = `${definition.name}.${member.name}`;
    const memberName = phpString(member.name);
    if (this.isOptionalOpaque(member))
      return `${HYDRATION}::optionalOpaque($members, ${memberName})`;
    if (member.required) {
      const raw = `${HYDRATION}::required($members, ${memberName}, ${phpString(definition.name)})`;
      return this.hydrate(member.type, raw, at);
    }
    return `${HYDRATION}::optional($members, ${memberName}, ${this.hydrator(member.type, at)})`;
  }

  private toJson(definition: StructDefinition): string[] {
    const lines = [
      `${INDENT}public function toJson(): \\stdClass`,
      `${INDENT}{`,
      `${INDENT}${INDENT}$json = new \\stdClass();`,
    ];
    for (const member of definition.members) {
      const property = `$this->${propertyName(member.name)}`;
      const key = `$json->{${phpString(member.name)}}`;
      if (this.isOptionalOpaque(member)) {
        lines.push(
          `${INDENT}${INDENT}if (${property} !== null) {`,
          `${INDENT}${INDENT}${INDENT}${key} = ${HYDRATION}::copy(${property}->value);`,
          `${INDENT}${INDENT}}`,
        );
        continue;
      }
      const encoded = this.encode(member.type, property) ?? property;
      if (member.required || member.type.kind === "opaque") {
        lines.push(`${INDENT}${INDENT}${key} = ${encoded};`);
        continue;
      }
      lines.push(
        `${INDENT}${INDENT}if (${property} !== null) {`,
        `${INDENT}${INDENT}${INDENT}${key} = ${encoded};`,
        `${INDENT}${INDENT}}`,
      );
    }
    lines.push(`${INDENT}${INDENT}return $json;`, `${INDENT}}`);
    return lines;
  }

  private union(definition: UnionDefinition): [string, string[]][] {
    const name = this.className(definition.name);
    const unknown = `${name}${UNKNOWN_SUFFIX}`;
    const tag = propertyName(definition.tag);
    const knownTags = definition.variants.map((variant) => phpString(variant.tagValue)).join(", ");
    const cases = definition.variants.map(
      (variant) =>
        `${INDENT}${INDENT}${INDENT}${phpString(variant.tagValue)} => ${this.className(variant.definition)}::fromJson($members),`,
    );

    const base = [
      ...docLine(definitionDoc(definition), ""),
      `abstract readonly class ${name}`,
      "{",
      `${INDENT}/** The tag member '${definition.tag}': it picks the variant. */`,
      `${INDENT}abstract public function tag(): string;`,
      "",
      `${INDENT}abstract public function toJson(): \\stdClass;`,
      "",
      `${INDENT}public static function fromJson(mixed $value): self`,
      `${INDENT}{`,
      `${INDENT}${INDENT}$members = ${HYDRATION}::object($value, ${phpString(definition.name)});`,
      `${INDENT}${INDENT}$tag = ${HYDRATION}::unionTag($members, ${phpString(definition.tag)}, ${phpString(definition.name)});`,
      "",
      `${INDENT}${INDENT}return match ($tag) {`,
      ...cases,
      `${INDENT}${INDENT}${INDENT}default => new ${unknown}($tag, $members),`,
      `${INDENT}${INDENT}};`,
      `${INDENT}}`,
      "}",
      "",
    ];

    const unknownClass = [
      "/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */",
      `final readonly class ${unknown} extends ${name}`,
      "{",
      `${INDENT}public \\stdClass $raw;`,
      "",
      `${INDENT}public function __construct(`,
      `${INDENT}${INDENT}public string $${tag},`,
      `${INDENT}${INDENT}\\stdClass $raw,`,
      `${INDENT}) {`,
      `${INDENT}${INDENT}if (in_array($${tag}, [${knownTags}], true)) {`,
      `${INDENT}${INDENT}${INDENT}throw new IrModelException(${phpString(`${definition.name}Unknown: the ${definition.tag} is a known one`)});`,
      `${INDENT}${INDENT}}`,
      `${INDENT}${INDENT}if (($raw->{${phpString(definition.tag)}} ?? null) !== $${tag}) {`,
      `${INDENT}${INDENT}${INDENT}throw new IrModelException(${phpString(`${definition.name}Unknown: raw does not carry the ${definition.tag}`)});`,
      `${INDENT}${INDENT}}`,
      `${INDENT}${INDENT}$this->raw = ${HYDRATION}::copyObject($raw);`,
      `${INDENT}}`,
      "",
      `${INDENT}public function tag(): string`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return $this->${tag};`,
      `${INDENT}}`,
      "",
      `${INDENT}public function toJson(): \\stdClass`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return ${HYDRATION}::copyObject($this->raw);`,
      `${INDENT}}`,
      "}",
      "",
    ];
    return [
      [name, base],
      [unknown, unknownClass],
    ];
  }

  private openEnum(definition: OpenEnumDefinition): string[] {
    const name = this.className(definition.name);
    const constants = enumConstants(definition);

    return [
      ...docLine(definitionDoc(definition), ""),
      `final readonly class ${name}`,
      "{",
      ...constants.map(
        ({ constant, value }) => `${INDENT}public const ${constant} = ${phpString(value)};`,
      ),
      "",
      `${INDENT}private function __construct(public string $value)`,
      `${INDENT}{`,
      `${INDENT}}`,
      "",
      `${INDENT}/**`,
      `${INDENT} * The values this IR revision knows, in the schema's order.`,
      `${INDENT} *`,
      `${INDENT} * @return list<string>`,
      `${INDENT} */`,
      `${INDENT}public static function known(): array`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return [${constants.map(({ constant }) => `self::${constant}`).join(", ")}];`,
      `${INDENT}}`,
      "",
      `${INDENT}/** A value this IR revision does not know is kept; \`isKnown()\` tells it apart. */`,
      `${INDENT}public static function of(string $value): self`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return new self($value);`,
      `${INDENT}}`,
      "",
      `${INDENT}public function isKnown(): bool`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return in_array($this->value, self::known(), true);`,
      `${INDENT}}`,
      "",
      `${INDENT}public static function fromJson(mixed $value): self`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return new self(${HYDRATION}::string($value, ${phpString(definition.name)}));`,
      `${INDENT}}`,
      "",
      `${INDENT}public function toJson(): string`,
      `${INDENT}{`,
      `${INDENT}${INDENT}return $this->value;`,
      `${INDENT}}`,
      "}",
      "",
    ];
  }

  /** The class carrying one `@phpstan-type` per alias definition and extension slot. */
  typesClass(model: NeutralModel): string[] {
    const lines = ["/**", " * The IR's alias definitions, as type aliases for static analysis."];
    for (const definition of model.definitions) {
      if (definition.kind === "alias") {
        lines.push(
          ` * @phpstan-type ${this.className(definition.name)} ${this.doc(definition.target, true)}`,
        );
      } else if (definition.kind === "extensionSlot") {
        lines.push(` * @phpstan-type ${this.className(definition.name)} \\stdClass`);
      }
    }
    lines.push(" */", "final class IrTypes", "{", "}", "");
    return lines;
  }
}

/** The constant of each known value: the ADR 0007 enum member identifier (`application/json` gives `ApplicationJson`). */
function enumConstants(definition: OpenEnumDefinition): { constant: string; value: string }[] {
  const seen = new Map<string, string>();
  return definition.known.map((value) => {
    const segments = splitName(value);
    if (segments.length === 0)
      throw new NameCollisionError(
        `${definition.name}: the known value ${JSON.stringify(value)} has no name segment`,
      );
    const constant = identifier({ segments, role: "enumMember" }, "php");
    if (constant === undefined)
      throw new Error(`${definition.name}: PHP has no enum member identifier`);
    const previous = seen.get(constant);
    if (previous !== undefined) {
      throw new NameCollisionError(
        `${definition.name}: the known values ${JSON.stringify(previous)} and ${JSON.stringify(value)} both give the PHP constant ${constant}`,
      );
    }
    seen.set(constant, value);
    return { constant, value };
  });
}

function phpShape(shape: Shape): string {
  switch (shape.kind) {
    case "named":
      return `IrShape::named(${phpString(shape.definition)})`;
    case "struct": {
      const members = shape.members.map(
        (member) => `${phpString(member.name)} => ${phpShape(member.shape)}`,
      );
      return `IrShape::struct([${members.join(", ")}])`;
    }
    case "union": {
      const variants = shape.variants.map(
        (variant) => `${phpString(variant.tagValue)} => ${phpString(variant.definition)}`,
      );
      return `IrShape::union(${phpString(shape.tag)}, ${shape.mustAct}, [${variants.join(", ")}])`;
    }
    case "openEnum":
      return `IrShape::openEnum([${shape.known.map(phpString).join(", ")}], ${shape.mustAct})`;
    case "items":
      return `IrShape::items(${phpShape(shape.of)})`;
    case "values":
      return `IrShape::values(${phpShape(shape.of)})`;
  }
}

/** The shape table: every definition that holds a walked member, a union or an open enum. */
function shapesClass(definitions: readonly Definition[]): string[] {
  const entries = definitions.flatMap((definition) => {
    const shape = shapeOfDefinition(definition);
    return shape === undefined
      ? []
      : [`${INDENT}${INDENT}${INDENT}${phpString(definition.name)} => ${phpShape(shape)},`];
  });
  return [
    "/** The shape of every IR definition that the must-act walk enters, by schema name. */",
    "final class IrShapes",
    "{",
    `${INDENT}/** @var array<string, IrShape>|null */`,
    `${INDENT}private static ?array $table = null;`,
    "",
    `${INDENT}/** @return array<string, IrShape> */`,
    `${INDENT}public static function table(): array`,
    `${INDENT}{`,
    `${INDENT}${INDENT}return self::$table ??= [`,
    ...entries,
    `${INDENT}${INDENT}];`,
    `${INDENT}}`,
    "}",
    "",
  ];
}
