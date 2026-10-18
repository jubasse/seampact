import type { IrWriter } from "@seampact/spec/ir";
import type { PassReadonly } from "../pipeline/readonly.js";
import { pipelineCopy, pipelineIsJsonObject, pipelinePointerBelow } from "../pipeline/seam.js";
import type { JsonValue } from "../raw-tree.js";
import { quote } from "../validate/diagnostics.js";

// The template language of ADR 0002 section 13: a raw template read into the IR's `Template`. The caller owns the
// place: the slots it fills, with their kinds, and the reporter that turns each fault into its own diagnostic.

/**
 * What a slot holds, which sets where it may stand: `$merge` takes an object, `$each` an array, and a `$` key a
 * name. `payload` holds an operation's payload, which may be either and is checked per operation by the caller.
 */
export type TemplateSlotKind = "object" | "array" | "name" | "value" | "flag" | "payload";

/** A slot a place fills. */
export interface TemplateSlot {
  readonly name: string;
  readonly kind: TemplateSlotKind;
}

/** The faults of a template, one rule each; the caller maps them to its own rule ids. */
export type TemplateRule =
  | "template-slot"
  | "template-syntax"
  | "template-merge"
  | "template-each"
  | "template-name";

/** One fault, at the raw pointer it is written at. */
export interface TemplateFault {
  readonly rule: TemplateRule;
  readonly pointer: string;
  readonly message: string;
  readonly fix: string;
}

/** Where a template is read: the slots of its place, its owner and placement as messages name them, its reporter. */
export interface TemplateSite {
  readonly slots: readonly TemplateSlot[];
  /** The slots `$as` adds: the element of the array slot and what is read from it. */
  readonly eachSlots: readonly TemplateSlot[];
  /** The owner, as messages name it: `the format acmeEnvelope`, `the paging style cursor`. */
  readonly owner: string;
  /** The place, as messages name it: `success.item`, `an error body`. */
  readonly placeName: string;
  /** The slot messages give as the example of a whole slot: `$payload`. */
  readonly exampleSlot: string;
  /** The ADR sections messages cite for the slots of the place: `ADR 0002 sections 13 and 14`. */
  readonly adrSections: string;
  readonly report: (fault: TemplateFault) => void;
}

/** A slot a template writes, with the member path read from it. */
export interface TemplateSlotUse {
  readonly slot: string;
  readonly path: readonly string[];
}

type Json = PassReadonly<JsonValue>;

interface Reading {
  readonly site: TemplateSite;
  readonly inEach: boolean;
  faults: number;
}

/** Where a slot stands in a template: spread by `$merge`, mapped by `$each`, or naming a member. */
type SlotStand = "merge" | "each" | "name";

interface StandRule {
  readonly rule: TemplateRule;
  readonly kinds: readonly TemplateSlotKind[];
  readonly verb: string;
  readonly need: string;
  readonly fix: (slots: string) => string;
  /** Said after the fix when no slot of the place fits. */
  readonly noFitHint: string;
}

const STAND_RULES: Readonly<Record<SlotStand, StandRule>> = {
  merge: {
    rule: "template-merge",
    kinds: ["object", "payload"],
    verb: "merges",
    need: "object",
    fix: (slots) => `Merge an object slot (${slots}), or write the slot as a member.`,
    noFitHint: "",
  },
  each: {
    rule: "template-each",
    kinds: ["array", "payload"],
    verb: "maps with $each",
    need: "array",
    fix: (slots) => `Map an array slot (${slots}), or write the slot as a member.`,
    noFitHint: "",
  },
  name: {
    rule: "template-name",
    kinds: ["name"],
    verb: "names a member with",
    need: "name",
    fix: (slots) => `Name the member with a name slot (${slots}), or write $$ for a literal $.`,
    noFitHint: " Write $$ for a literal $.",
  },
};

const MERGE_KEY = "$merge";
const EACH_KEY = "$each";
const AS_KEY = "$as";

const SLOT_NAME = "[A-Za-z][A-Za-z0-9]*";
const MEMBER_NAME = "[A-Za-z_][A-Za-z0-9_]*";
const WHOLE_SLOT = new RegExp(`^\\$(${SLOT_NAME})((?:\\.${MEMBER_NAME})*)$`);
const TEXT_SLOT = new RegExp(`^\\$\\{(${SLOT_NAME})((?:\\.${MEMBER_NAME})*)\\}`);
const NAME_SLOT = new RegExp(`^\\$(${SLOT_NAME})$`);

/** The template written at `pointer`, undefined when it is refused (each fault reported where it is written). */
export function templateRead(
  site: TemplateSite,
  value: Json,
  pointer: string,
): IrWriter.Template | undefined {
  const reading: Reading = { site, inEach: false, faults: 0 };
  const template = templateOf(reading, value, pointer);

  return reading.faults === 0 ? template : undefined;
}

/** Every slot a template writes: whole slots, text parts, member names, the merged slot and each array slot. */
export function templateSlots(template: IrWriter.Template): TemplateSlotUse[] {
  switch (template.kind) {
    case "slot":
      return [{ slot: template.slot, path: template.path }];
    case "text":
      return template.parts.flatMap((part) =>
        part.kind === "slot" ? [{ slot: part.slot, path: part.path }] : [],
      );
    case "literal":
      return [];
    case "object":
      return [
        ...(template.merge === undefined ? [] : [{ slot: template.merge, path: [] }]),
        ...template.members.flatMap((member) => [
          ...(member.name.kind === "slot" ? [{ slot: member.name.slot, path: [] }] : []),
          ...templateSlots(member.value),
        ]),
      ];
    case "array":
      return template.items.flatMap(templateSlots);
    case "each":
      return [{ slot: template.of, path: [] }, ...templateSlots(template.as)];
  }
}

/** Whether a template writes `slot` anywhere. */
export const templateUses = (template: IrWriter.Template, slot: string): boolean =>
  templateSlots(template).some((used) => used.slot === slot);

function templateOf(reading: Reading, value: Json, pointer: string): IrWriter.Template | undefined {
  if (typeof value === "string") return stringTemplate(reading, value, pointer);

  if (Array.isArray(value))
    return {
      kind: "array",
      items: value.flatMap((item, index) => {
        const template = templateOf(reading, item, `${pointer}/${index}`);

        return template === undefined ? [] : [template];
      }),
    };

  if (pipelineIsJsonObject(value)) return objectTemplate(reading, value, pointer);

  return { kind: "literal", value: pipelineCopy(value) };
}

function stringTemplate(
  reading: Reading,
  value: string,
  pointer: string,
): IrWriter.Template | undefined {
  const whole = WHOLE_SLOT.exec(value);

  if (whole !== null) {
    const [, slot = "", path = ""] = whole;

    return checkSlot(reading, slot, pointer)
      ? { kind: "slot", slot, path: pathOf(path) }
      : undefined;
  }

  const parts = textParts(reading, value, pointer);

  if (parts === undefined) return undefined;

  if (parts.every((part) => part.kind === "text"))
    return {
      kind: "literal",
      value: parts.map((part) => (part.kind === "text" ? part.text : "")).join(""),
    };

  return { kind: "text", parts };
}

const pathOf = (path: string): string[] => (path === "" ? [] : path.slice(1).split("."));

// `$$` writes a literal `$`, `${name}` a slot's text; any other `$` is refused, since it reads like a slot.
function textParts(
  reading: Reading,
  value: string,
  pointer: string,
): IrWriter.TextPart[] | undefined {
  const parts: IrWriter.TextPart[] = [];
  let text = "";
  let rest = value;

  while (rest !== "") {
    const dollar = rest.indexOf("$");

    if (dollar === -1) {
      text += rest;
      break;
    }

    text += rest.slice(0, dollar);
    rest = rest.slice(dollar);

    if (rest.startsWith("$$")) {
      text += "$";
      rest = rest.slice(2);
      continue;
    }

    const slot = TEXT_SLOT.exec(rest);

    if (slot === null)
      return refuseSyntax(
        reading,
        pointer,
        `the text ${quote(value)} writes a $ that starts no slot`,
      );

    const [written, name = "", path = ""] = slot;

    if (!checkSlot(reading, name, pointer)) return undefined;

    if (text !== "") parts.push({ kind: "text", text });
    text = "";
    parts.push({ kind: "slot", slot: name, path: pathOf(path) });
    rest = rest.slice(written.length);
  }

  if (text !== "") parts.push({ kind: "text", text });

  return parts;
}

function objectTemplate(
  reading: Reading,
  value: Readonly<Record<string, Json>>,
  pointer: string,
): IrWriter.Template | undefined {
  if (Object.hasOwn(value, EACH_KEY) || Object.hasOwn(value, AS_KEY))
    return eachTemplate(reading, value, pointer);

  const members: IrWriter.ObjectTemplateMember[] = [];
  let merge: string | undefined;

  for (const [key, member] of Object.entries(value)) {
    const memberPointer = pipelinePointerBelow(pointer, key);

    if (key === MERGE_KEY) {
      merge = slotName(reading, member, memberPointer, "merge");
      continue;
    }

    const name = memberName(reading, key, memberPointer);
    const template = templateOf(reading, member, memberPointer);

    if (name !== undefined && template !== undefined) members.push({ name, value: template });
  }

  return { kind: "object", members, ...(merge === undefined ? {} : { merge }) };
}

function memberName(
  reading: Reading,
  key: string,
  pointer: string,
): IrWriter.MemberName | undefined {
  if (key.startsWith("$$")) return { kind: "text", text: key.slice(1) };

  if (!key.startsWith("$")) return { kind: "text", text: key };

  const slot = NAME_SLOT.exec(key)?.[1];

  if (slot === undefined)
    return refuseSyntax(
      reading,
      pointer,
      `the member name ${quote(key)} is no slot (write $$ for a literal $)`,
    );

  return checkSlot(reading, slot, pointer) && checkStand(reading, slot, pointer, "name")
    ? { kind: "slot", slot }
    : undefined;
}

function eachTemplate(
  reading: Reading,
  value: Readonly<Record<string, Json>>,
  pointer: string,
): IrWriter.Template | undefined {
  const keys = Object.keys(value);

  if (keys.length !== 2 || !Object.hasOwn(value, EACH_KEY) || !Object.hasOwn(value, AS_KEY))
    return refuseSyntax(
      reading,
      pointer,
      `an array template is { ${EACH_KEY}, ${AS_KEY} } and nothing else`,
    );

  const of = slotName(reading, value[EACH_KEY], pipelinePointerBelow(pointer, EACH_KEY), "each");
  const inner: Reading = { site: reading.site, inEach: true, faults: 0 };
  const as = templateOf(inner, value[AS_KEY] ?? null, pipelinePointerBelow(pointer, AS_KEY));

  reading.faults += inner.faults;

  return of === undefined || as === undefined ? undefined : { kind: "each", of, as };
}

const STAND_KEYS: Readonly<Record<"merge" | "each", string>> = { merge: MERGE_KEY, each: EACH_KEY };

// `$merge` and `$each` take a whole slot without a member path.
function slotName(
  reading: Reading,
  value: Json | undefined,
  pointer: string,
  stand: "merge" | "each",
): string | undefined {
  const slot = typeof value === "string" ? NAME_SLOT.exec(value)?.[1] : undefined;

  if (slot === undefined)
    return refuseSyntax(
      reading,
      pointer,
      `${STAND_KEYS[stand]} takes one slot (${reading.site.exampleSlot}), without a member path`,
    );

  return checkSlot(reading, slot, pointer) && checkStand(reading, slot, pointer, stand)
    ? slot
    : undefined;
}

// The slots a reading may write: its place's, and inside `$as` the element's too.
const readableSlots = (reading: Reading): readonly TemplateSlot[] =>
  reading.inEach ? [...reading.site.slots, ...reading.site.eachSlots] : reading.site.slots;

const slotOf = (reading: Reading, name: string): TemplateSlot | undefined =>
  readableSlots(reading).find((slot) => slot.name === name);

// ADR 0002 section 13: a slot stands where its kind fits; a `payload` slot is checked per operation by the caller.
function checkStand(reading: Reading, slot: string, pointer: string, stand: SlotStand): boolean {
  const { rule, kinds, verb, need, fix, noFitHint } = STAND_RULES[stand];
  const kind = slotOf(reading, slot)?.kind ?? "value";

  if (kinds.includes(kind)) return true;

  const { site } = reading;
  const fitting = readableSlots(reading)
    .filter((candidate) => kinds.includes(candidate.kind))
    .map((candidate) => `$${candidate.name}`);

  reading.faults += 1;
  site.report({
    rule,
    pointer,
    message: `The template of ${site.owner} ${verb} ${quote(`$${slot}`)}, which holds no ${need}.`,
    fix:
      fitting.length > 0
        ? fix(fitting.join(", "))
        : `Write ${quote(`$${slot}`)} as a member: ${site.placeName} fills no slot that holds a ${need}.${noFitHint}`,
  });

  return false;
}

function checkSlot(reading: Reading, slot: string, pointer: string): boolean {
  if (slotOf(reading, slot) !== undefined) return true;

  const { site } = reading;

  reading.faults += 1;
  site.report({
    rule: "template-slot",
    pointer,
    message: `The template of ${site.owner} writes the slot ${quote(`$${slot}`)}, which ${site.placeName} does not fill.`,
    fix: `Use a slot of ${site.placeName} (${site.adrSections}), or write ${quote(`$$${slot}`)} for the literal text.`,
  });

  return false;
}

function refuseSyntax(reading: Reading, pointer: string, why: string): undefined {
  const { site } = reading;

  reading.faults += 1;
  site.report({
    rule: "template-syntax",
    pointer,
    message: `The template of ${site.owner} is not valid: ${why}.`,
    fix: `Write $name for a slot, \${name} inside a longer text, $$ for a literal $, and { $each: $slot, $as: <template> } for an array.`,
  });

  return undefined;
}
