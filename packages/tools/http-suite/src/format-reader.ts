// Reads a response of a wire format back into bare terms by inverting the format's templates (ADR 0015 "Suite
// profiles"): the payload, a page's items, an error's code and params come out as the default format writes them.
import {
  isKnownVariant,
  type ObjectTemplate,
  type PagingStyle,
  type Template,
  type WireFormat,
} from "@seampact/spec/ir";
import { isJsonObject } from "./response-check.js";
import type { JsonValue } from "./suite-case.js";

const ERROR_STATUS_FLOOR = 400;
const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";
const ITEM_SLOT = "item";
const PARAMS_SLOT = "params";
const CODE_SLOT = "code";
const BARE_ERROR_SLOTS = ["code", "nature", "title", "status", "detail", "instance", "traceId"];

/** A template the suite cannot invert, named by its format and member. */
export class FormatReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatReaderError";
  }
}

/** A body in bare terms, and the ways it did not match the format's template. */
export interface ReadBody {
  readonly json: JsonValue;
  readonly failures: readonly string[];
}

export interface FormatReader {
  readonly formatId: string;
  /** The media type of the format's error responses. */
  readonly errorMedia: string;
  read(status: number, body: JsonValue): ReadBody;
}

interface SuccessShape {
  readonly name: string;
  readonly template: Template;
  readonly readSlot: string;
}

type Bindings = Map<string, JsonValue>;

/** The reader of `format` and, when the api pages, of the page body of `paging`; refuses a template it cannot invert. */
export function formatReaderOf(format: WireFormat, paging: PagingStyle | undefined): FormatReader {
  const pageTemplate = paging?.response.body ?? format.success.page.body;
  const shapes: SuccessShape[] = [
    { name: "page", template: pageTemplate, readSlot: ITEMS_SLOT },
    { name: "item", template: format.success.item.body, readSlot: PAYLOAD_SLOT },
    { name: "table", template: format.success.table.body, readSlot: PAYLOAD_SLOT },
    { name: "list", template: format.success.list.body, readSlot: PAYLOAD_SLOT },
  ];

  for (const shape of shapes) refuseUninvertible(format.id, shape.name, shape.template);

  refuseUninvertible(format.id, "error", format.error.body);
  refuseCodeOnlyInText(format.id, format.error.body);

  return {
    formatId: format.id,
    errorMedia: format.error.media,
    read: (status, body) =>
      status >= ERROR_STATUS_FLOOR ? readError(format, body) : readSuccess(format.id, shapes, body),
  };
}

function readSuccess(formatId: string, shapes: readonly SuccessShape[], body: JsonValue): ReadBody {
  const misses: string[] = [];

  for (const shape of shapes) {
    const bindings: Bindings = new Map();
    const failures = invert(shape.template, body, bindings, "", true);
    const read = bindings.get(shape.readSlot);

    if (failures.length === 0 && read !== undefined) return { json: read, failures: [] };

    misses.push(`${shape.name}: ${failures.join(", ") || `no $${shape.readSlot}`}`);
  }

  return {
    json: body,
    failures: [`the body fits no success shape of format '${formatId}' (${misses.join("; ")})`],
  };
}

function readError(format: WireFormat, body: JsonValue): ReadBody {
  const bindings: Bindings = new Map();
  const failures = invert(format.error.body, body, bindings, "", false);

  if (failures.length > 0) return { json: body, failures };

  if (!bindings.has(CODE_SLOT)) {
    return {
      json: body,
      failures: [`the error body of format '${format.id}' holds no code`],
    };
  }

  const params = bindings.get(PARAMS_SLOT);
  const bare: Record<string, JsonValue> = {};

  for (const slot of BARE_ERROR_SLOTS) {
    const value = bindings.get(slot);

    if (value !== undefined) bare[slot] = value;
  }

  return {
    json: { ...bare, ...(params !== undefined && isJsonObject(params) ? params : {}) },
    failures: [],
  };
}

// Returns what does not match; a slot reads whatever stands where it is written.
function invert(
  template: Template,
  value: JsonValue,
  bindings: Bindings,
  pointer: string,
  strict: boolean,
): string[] {
  if (!isKnownVariant("Template", template)) return [`${at(pointer)}: unknown template`];

  switch (template.kind) {
    case "slot":
      return invertSlot(template.slot, value, bindings, pointer);
    case "text":
    case "literal":
      return [];
    case "array":
      return invertArray(template.items, value, bindings, pointer);
    case "each":
      return invertEach(template, value, bindings, pointer);
    case "object":
      return invertObject(template, value, bindings, pointer, strict);
  }
}

function invertSlot(slot: string, value: JsonValue, bindings: Bindings, pointer: string): string[] {
  if (slot === ITEMS_SLOT && !Array.isArray(value)) return [`${at(pointer)}: expected an array`];

  bindings.set(slot, value);

  return [];
}

function invertArray(
  items: readonly Template[],
  value: JsonValue,
  bindings: Bindings,
  pointer: string,
): string[] {
  if (value === null) return [];

  if (!Array.isArray(value) || value.length !== items.length) {
    return [`${at(pointer)}: expected an array of ${items.length}`];
  }

  return items.flatMap((item, index) =>
    invert(item, value[index] ?? null, bindings, `${pointer}/${index}`, false),
  );
}

function invertEach(
  template: Extract<Template, { kind: "each" }>,
  value: JsonValue,
  bindings: Bindings,
  pointer: string,
): string[] {
  if (value === null) return [];

  if (!Array.isArray(value)) return [`${at(pointer)}: expected an array`];

  const elements: JsonValue[] = [];
  const failures: string[] = [];

  value.forEach((element, index) => {
    const elementBindings: Bindings = new Map();

    failures.push(...invert(template.as, element, elementBindings, `${pointer}/${index}`, false));
    elements.push(elementBindings.get(ITEM_SLOT) ?? element);
  });

  bindings.set(template.of, elements);

  return failures;
}

function invertObject(
  template: ObjectTemplate,
  value: JsonValue,
  bindings: Bindings,
  pointer: string,
  strict: boolean,
): string[] {
  if (value === null) return [];

  if (!isJsonObject(value)) return [`${at(pointer)}: expected an object`];

  const literalNames = new Set(template.members.flatMap((member) => literalNameOf(member.name)));
  const unclaimed = Object.keys(value).filter((name) => !literalNames.has(name));
  const failures: string[] = [];

  for (const member of template.members) {
    const name = literalNameOf(member.name)[0] ?? unclaimed[0];
    const memberValue = name === undefined ? undefined : value[name];

    if (memberValue === undefined) {
      if (strict && isRequiredMember(member.value)) {
        failures.push(`${at(`${pointer}/${name ?? "*"}`)}: member is absent`);
      }

      continue;
    }

    failures.push(...invert(member.value, memberValue, bindings, `${pointer}/${name}`, false));
  }

  if (template.merge !== undefined) {
    bindings.set(
      template.merge,
      Object.fromEntries(unclaimed.map((name) => [name, value[name] ?? null])),
    );
  }

  return failures;
}

function literalNameOf(name: ObjectTemplate["members"][number]["name"]): string[] {
  return isKnownVariant("MemberName", name) && name.kind === "text" ? [name.text] : [];
}

// A member whose value is a plain slot may have no value (a last page has no `next`), except the data itself.
function isRequiredMember(value: Template): boolean {
  if (!isKnownVariant("Template", value) || value.kind !== "slot") return true;

  return value.slot === ITEMS_SLOT || value.slot === PAYLOAD_SLOT;
}

function at(pointer: string): string {
  return pointer === "" ? "/" : pointer;
}

// A slot written with a member path, a member named by a slot beside `$merge`, or a kind the suite does not know.
function refuseUninvertible(formatId: string, where: string, template: Template): void {
  if (!isKnownVariant("Template", template)) {
    throw new FormatReaderError(
      `format '${formatId}', ${where}: unknown template kind '${template.kind}'`,
    );
  }

  switch (template.kind) {
    case "slot":
      if (template.path.length > 0) {
        throw new FormatReaderError(
          `format '${formatId}', ${where}: the slot '$${template.slot}.${template.path.join(".")}' cannot be read back`,
        );
      }

      return;
    case "array":
      for (const item of template.items) refuseUninvertible(formatId, where, item);

      return;
    case "each":
      refuseUninvertible(formatId, where, template.as);

      return;
    case "object":
      refuseUninvertibleObject(formatId, where, template);

      return;
    default:
      return;
  }
}

function refuseUninvertibleObject(formatId: string, where: string, template: ObjectTemplate): void {
  const namedBySlot = template.members.some((member) => literalNameOf(member.name).length === 0);

  if (namedBySlot && template.merge !== undefined) {
    throw new FormatReaderError(
      `format '${formatId}', ${where}: a member named by a slot beside '$merge: $${template.merge}' cannot be read back`,
    );
  }

  for (const member of template.members) refuseUninvertible(formatId, where, member.value);
}

// A code only inside a text template (`'https://errors.acme.com/${code}'`) cannot be read back.
function refuseCodeOnlyInText(formatId: string, template: Template): void {
  if (writesSlotAlone(template, CODE_SLOT) || !isKnownVariant("Template", template)) return;

  const member =
    template.kind === "object"
      ? template.members.find((candidate) => textMentionsSlot(candidate.value, CODE_SLOT))
      : undefined;
  const name = member === undefined ? undefined : literalNameOf(member.name)[0];

  throw new FormatReaderError(
    name === undefined
      ? `format '${formatId}', error: the body writes no '$code' member`
      : `format '${formatId}', error: the member '${name}' writes the code only inside a text template, which cannot be read back`,
  );
}

function writesSlotAlone(template: Template, slot: string): boolean {
  if (!isKnownVariant("Template", template)) return false;

  switch (template.kind) {
    case "slot":
      return template.slot === slot;
    case "object":
      return template.members.some((member) => writesSlotAlone(member.value, slot));
    case "array":
      return template.items.some((item) => writesSlotAlone(item, slot));
    case "each":
      return writesSlotAlone(template.as, slot);
    default:
      return false;
  }
}

function textMentionsSlot(template: Template, slot: string): boolean {
  if (!isKnownVariant("Template", template)) return false;

  switch (template.kind) {
    case "text":
      return template.parts.some(
        (part) => isKnownVariant("TextPart", part) && part.kind === "slot" && part.slot === slot,
      );
    case "object":
      return template.members.some((member) => textMentionsSlot(member.value, slot));
    default:
      return false;
  }
}
