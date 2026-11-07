// Reads a response of a wire format back into bare terms by inverting the format's templates (ADR 0015 "Suite
// profiles"): the payload, a page's items, an error's code and params come out as the default format writes them. A
// success is read with the shape its operation declares, so a body the format would not write fails.
import { isDeepStrictEqual } from "node:util";
import {
  isKnownVariant,
  type KnownTextPart,
  type MemberName,
  type ObjectTemplate,
  type Operation,
  type PagingStyle,
  type Template,
  type TextPart,
  type WireFormat,
} from "@seampact/spec/ir";
import { operationAnswering, type SentRequest } from "./operation-match.js";
import { isJsonObject } from "./response-check.js";
import type { JsonValue } from "./suite-case.js";

const ERROR_STATUS_FLOOR = 400;
const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";
const ITEM_SLOT = "item";
const PARAMS_SLOT = "params";
const CODE_SLOT = "code";
const BARE_ERROR_SLOTS = ["code", "nature", "title", "status", "detail", "instance", "traceId"];

// Shapes the format does not write: their body is checked as the server sent it.
const BYPASSED_SHAPES: readonly string[] = ["empty", "binary", "redirect"];

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
  /** The media type of the format's success responses. */
  readonly media: string;
  /** The media type of the format's error responses. */
  readonly errorMedia: string;
  /** Reads `body` with the shape the operation answering `request` declares for `status`. */
  read(status: number, body: JsonValue, request: SentRequest): ReadBody;
}

interface SuccessShape {
  readonly template: Template;
  readonly readSlot: string;
}

// What the slots read so far hold: a value written alone, or the text a text template gave it.
interface Bindings {
  readonly values: Map<string, JsonValue>;
  readonly texts: Map<string, string>;
}

/**
 * The reader of `format` and, when the api pages, of the page body of `paging`, for the operations of the target;
 * refuses a template it cannot invert.
 */
export function formatReaderOf(
  format: WireFormat,
  paging: PagingStyle | undefined,
  operations: readonly Operation[],
): FormatReader {
  const shapes: Readonly<Record<string, SuccessShape>> = {
    page: { template: paging?.response.body ?? format.success.page.body, readSlot: ITEMS_SLOT },
    item: { template: format.success.item.body, readSlot: PAYLOAD_SLOT },
    table: { template: format.success.table.body, readSlot: PAYLOAD_SLOT },
    list: { template: format.success.list.body, readSlot: PAYLOAD_SLOT },
  };

  for (const [name, shape] of Object.entries(shapes)) {
    refuseUninvertible(format.id, name, shape.template);
  }

  refuseUninvertible(format.id, "error", format.error.body);
  refuseCodeOnlyInText(format.id, format.error.body);

  return {
    formatId: format.id,
    media: format.media,
    errorMedia: format.error.media,
    read: (status, body, request) => {
      if (status >= ERROR_STATUS_FLOOR) return readError(format, body);

      const expected = expectedShapeOf(format.id, operations, status, request);

      if (typeof expected !== "string") return { json: body, failures: expected.failures };

      if (BYPASSED_SHAPES.includes(expected)) return { json: body, failures: [] };

      const shape = shapes[expected];

      if (shape === undefined) {
        return { json: body, failures: [`the suite cannot read the response shape '${expected}'`] };
      }

      return readSuccess(format.id, expected, shape, body);
    },
  };
}

// The shape the operation answering the request declares for the status, or why there is none.
function expectedShapeOf(
  formatId: string,
  operations: readonly Operation[],
  status: number,
  request: SentRequest,
): string | { readonly failures: readonly string[] } {
  const operation = operationAnswering(operations, request);

  if (operation === undefined) {
    return {
      failures: [
        `no operation of the contract answers ${request.method} ${request.path}, so the suite cannot tell which shape of format '${formatId}' to read`,
      ],
    };
  }

  if (operation.format !== formatId) {
    return {
      failures: [
        `the operation '${operation.id}' answers in format '${operation.format}', but the profile reads format '${formatId}'`,
      ],
    };
  }

  const response = operation.responses.find((candidate) => candidate.status === status);

  if (response === undefined) {
    return { failures: [`the operation '${operation.id}' declares no ${status} response`] };
  }

  return response.shape;
}

function readSuccess(
  formatId: string,
  shapeName: string,
  shape: SuccessShape,
  body: JsonValue,
): ReadBody {
  const bindings = emptyBindings();
  const failures = invert(shape.template, body, bindings, "", true);
  const read = bindings.values.get(shape.readSlot);

  if (failures.length > 0 || read === undefined) {
    return {
      json: body,
      failures: [
        `the body is no ${shapeName} of format '${formatId}' (${failures.join(", ") || `no $${shape.readSlot}`})`,
      ],
    };
  }

  return { json: read, failures: [] };
}

function readError(format: WireFormat, body: JsonValue): ReadBody {
  const bindings = emptyBindings();
  const failures = invert(format.error.body, body, bindings, "", false);

  if (failures.length > 0) return { json: body, failures };

  if (!bindings.values.has(CODE_SLOT)) {
    return {
      json: body,
      failures: [`the error body of format '${format.id}' holds no code`],
    };
  }

  const params = bindings.values.get(PARAMS_SLOT);
  const bare: Record<string, JsonValue> = {};

  for (const slot of BARE_ERROR_SLOTS) {
    const value = bindings.values.get(slot);

    if (value !== undefined) bare[slot] = value;
  }

  return {
    json: { ...bare, ...(params !== undefined && isJsonObject(params) ? params : {}) },
    failures: [],
  };
}

function emptyBindings(): Bindings {
  return { values: new Map(), texts: new Map() };
}

function copyOf(bindings: Bindings): Bindings {
  return { values: new Map(bindings.values), texts: new Map(bindings.texts) };
}

// Returns what does not match; a slot reads whatever stands where it is written, and must read the same value
// wherever it is written.
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
      return invertText(template.parts, value, bindings, pointer);
    case "literal":
      return isDeepStrictEqual(template.value, value)
        ? []
        : [
            `${at(pointer)}: expected ${JSON.stringify(template.value)}, got ${JSON.stringify(value)}`,
          ];
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

  const bound = bindings.values.get(slot);
  const text = bindings.texts.get(slot);

  if (bound !== undefined && !isDeepStrictEqual(bound, value)) {
    return [slotConflict(slot, pointer, bound, value)];
  }

  if (text !== undefined && !textAgrees(text, value))
    return [slotConflict(slot, pointer, text, value)];

  bindings.values.set(slot, value);

  return [];
}

// A text template matches its constant parts exactly; each slot part reads the text that stands in its place.
function invertText(
  parts: readonly TextPart[],
  value: JsonValue,
  bindings: Bindings,
  pointer: string,
): string[] {
  if (typeof value !== "string")
    return [`${at(pointer)}: expected a text, got ${JSON.stringify(value)}`];

  const knownParts = parts.filter((part) => isKnownVariant("TextPart", part));

  if (knownParts.length !== parts.length) return [`${at(pointer)}: unknown text template part`];

  const slots = knownParts.flatMap((part) => (part.kind === "slot" ? [part.slot] : []));
  const pattern = knownParts
    .map((part) => (part.kind === "text" ? escapeForPattern(part.text) : "(.*?)"))
    .join("");
  const match = new RegExp(`^${pattern}$`, "s").exec(value);

  if (match === null) {
    return [
      `${at(pointer)}: ${JSON.stringify(value)} does not fit the text template '${textOf(knownParts)}'`,
    ];
  }

  return slots.flatMap((slot, index) => bindText(slot, match[index + 1] ?? "", bindings, pointer));
}

function bindText(slot: string, text: string, bindings: Bindings, pointer: string): string[] {
  const bound = bindings.values.get(slot);
  const earlierText = bindings.texts.get(slot);

  if (bound !== undefined && !textAgrees(text, bound))
    return [slotConflict(slot, pointer, bound, text)];

  if (earlierText !== undefined && earlierText !== text) {
    return [slotConflict(slot, pointer, earlierText, text)];
  }

  bindings.texts.set(slot, text);

  return [];
}

function textAgrees(text: string, value: JsonValue): boolean {
  const isScalar =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean";

  return isScalar && String(value) === text;
}

function slotConflict(slot: string, pointer: string, earlier: JsonValue, later: JsonValue): string {
  return `${at(pointer)}: the slot $${slot} reads ${JSON.stringify(later)} here but ${JSON.stringify(earlier)} elsewhere`;
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textOf(parts: readonly KnownTextPart[]): string {
  return parts.map((part) => (part.kind === "slot" ? `\${${part.slot}}` : part.text)).join("");
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

// Each element reads its own `$item` slots, and checks the slots it shares with the page against the page's.
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
    const elementBindings = copyOf(bindings);

    failures.push(...invert(template.as, element, elementBindings, `${pointer}/${index}`, false));
    elements.push(elementBindings.values.get(ITEM_SLOT) ?? element);
  });

  return [...failures, ...invertSlot(template.of, elements, bindings, pointer)];
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

  // The page-level slots are read before the elements that repeat them.
  const members = [...template.members].sort(
    (first, second) => Number(holdsEach(first.value)) - Number(holdsEach(second.value)),
  );

  for (const member of members) {
    const literalName = literalNameOf(member.name)[0];
    const named =
      literalName === undefined
        ? slotNamedMember(member.name, unclaimed, bindings, pointer)
        : { name: literalName, failures: [] };

    failures.push(...named.failures);

    if (named.failures.length > 0) continue;

    const memberValue = named.name === undefined ? undefined : value[named.name];

    if (memberValue === undefined) {
      if (strict && isRequiredMember(member.value)) {
        failures.push(`${at(`${pointer}/${named.name ?? "*"}`)}: member is absent`);
      }

      continue;
    }

    failures.push(
      ...invert(member.value, memberValue, bindings, `${pointer}/${named.name}`, false),
    );
  }

  if (template.merge !== undefined) {
    failures.push(
      ...invertSlot(
        template.merge,
        Object.fromEntries(unclaimed.map((name) => [name, value[name] ?? null])),
        bindings,
        pointer,
      ),
    );
  }

  return failures;
}

// A member named by a slot (`$collection`) is the one unclaimed member, or the one the slot already names.
function slotNamedMember(
  name: MemberName,
  candidates: readonly string[],
  bindings: Bindings,
  pointer: string,
): { readonly name: string | undefined; readonly failures: readonly string[] } {
  if (!isKnownVariant("MemberName", name) || name.kind !== "slot") {
    return { name: undefined, failures: [`${at(pointer)}: unknown member name`] };
  }

  const bound = bindings.values.get(name.slot) ?? bindings.texts.get(name.slot);

  if (typeof bound === "string" && candidates.includes(bound)) return { name: bound, failures: [] };

  const [only, ...others] = candidates;

  if (only === undefined) return { name: undefined, failures: [] };

  if (others.length > 0) {
    return {
      name: undefined,
      failures: [
        `${at(pointer)}: the members ${candidates.join(", ")} could each be the one named by $${name.slot}`,
      ],
    };
  }

  return { name: only, failures: invertSlot(name.slot, only, bindings, pointer) };
}

function holdsEach(template: Template): boolean {
  if (!isKnownVariant("Template", template)) return false;

  switch (template.kind) {
    case "each":
      return true;
    case "object":
      return template.members.some((member) => holdsEach(member.value));
    case "array":
      return template.items.some(holdsEach);
    default:
      return false;
  }
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
