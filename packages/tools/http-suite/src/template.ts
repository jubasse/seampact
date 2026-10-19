// The `{{...}}` placeholders of a case: credentials, values captured from earlier responses and generated values.
import { randomUUID } from "node:crypto";
import type { JsonValue } from "./suite-case.js";

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{([^{}]+)\}\}$/;
const UUID_PREFIX = "uuid:";
const DEADLINE_PREFIX = "deadline:";
const DEADLINE_MS = /^-?\d+$/;
const FILLER_PREFIX = "filler:";
const FILLER_LENGTH = /^\d+$/;
const FILLER_CHARACTER = "a";

/** A placeholder the case uses but no credential, capture or generator answers. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * The values one case reads: the named variables (credentials, then captures) and the UUIDs it generated, one
 * per label, so `{{uuid:key}}` is the same value in every step of the case.
 */
export class TemplateScope {
  readonly #variables = new Map<string, JsonValue>();
  readonly #uuids = new Map<string, string>();

  constructor(variables: Readonly<Record<string, JsonValue>>) {
    for (const [name, value] of Object.entries(variables)) this.#variables.set(name, value);
  }

  capture(name: string, value: JsonValue): void {
    this.#variables.set(name, structuredClone(value));
  }

  /**
   * A string that is one placeholder alone takes the variable's JSON value; elsewhere each placeholder is replaced
   * by its text.
   */
  fill(value: JsonValue): JsonValue {
    if (typeof value === "string") return this.#fillString(value);

    if (Array.isArray(value)) return value.map((item) => this.fill(item));

    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.fill(item)]));
    }

    return value;
  }

  fillText(text: string): string {
    return text.replace(PLACEHOLDER, (_placeholder, expression: string) =>
      this.#resolveText(expression),
    );
  }

  #fillString(text: string): JsonValue {
    const whole = WHOLE_PLACEHOLDER.exec(text);

    if (whole?.[1] !== undefined) return this.#resolve(whole[1].trim());

    return this.fillText(text);
  }

  #resolveText(expression: string): string {
    const value = this.#resolve(expression.trim());

    return typeof value === "string" ? value : JSON.stringify(value);
  }

  #resolve(name: string): JsonValue {
    if (name.startsWith(UUID_PREFIX)) return this.#uuid(name.slice(UUID_PREFIX.length));

    if (name.startsWith(DEADLINE_PREFIX)) return deadline(name.slice(DEADLINE_PREFIX.length));

    if (name.startsWith(FILLER_PREFIX)) return filler(name.slice(FILLER_PREFIX.length));

    const value = this.#variables.get(name);

    if (value === undefined) {
      const known = [...this.#variables.keys()].sort().join(", ");

      throw new TemplateError(
        `no value for '{{${name}}}'; known names: ${known}, and the generators uuid:<label>, deadline:<ms>, filler:<length>`,
      );
    }

    return value;
  }

  #uuid(label: string): string {
    const known = this.#uuids.get(label);

    if (known !== undefined) return known;

    const generated = randomUUID();

    this.#uuids.set(label, generated);

    return generated;
  }
}

// An RFC 3339 UTC date-time `milliseconds` from now (before now when negative), as a deadline header carries it.
function deadline(milliseconds: string): string {
  if (!DEADLINE_MS.test(milliseconds)) {
    throw new TemplateError(`'{{deadline:${milliseconds}}}' needs a whole number of milliseconds`);
  }

  return new Date(Date.now() + Number(milliseconds)).toISOString();
}

// A text of `length` ASCII characters, for a body above a size limit.
function filler(length: string): string {
  if (!FILLER_LENGTH.test(length)) {
    throw new TemplateError(`'{{filler:${length}}}' needs a whole number of characters`);
  }

  return FILLER_CHARACTER.repeat(Number(length));
}
