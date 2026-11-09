// The `input-rules` case's app input rules in VineJS: each rule from `vine.createRule` reports with its name, and the
// unnamed one reports with an empty name. The generated VineJS validators cannot be extended, so the part's schema is
// written here. The consumer harness copies this file to `src/input-rules.mts` when the validators are VineJS.
import vine from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";
import {
  endsAfterStart,
  noteIsNamed,
  type ScheduleWindow,
  windowWithinLimit,
} from "./input-rules-handlers.mjs";

const UNNAMED_RULE = "";

// On the `end` member, so the refusal points at it; the start is read from its parent.
const endAfterStart = vine.createRule((end: unknown, _options: undefined, field: FieldContext) => {
  const window = windowOf({ ...field.parent, end });

  if (window !== undefined && !endsAfterStart(window)) {
    field.report("The end must come after the start.", "endAfterStart", field);
  }
});

// On the whole body, so the refusal points at its root.
const windowTooLong = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    const window = windowOf(value);

    if (window !== undefined && !windowWithinLimit(window)) {
      field.report("The window is too long.", "windowTooLong", field);
    }
  },
);

const unnamedNoteRule = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    const window = windowOf(value);

    if (window !== undefined && !noteIsNamed(window)) {
      field.report("The note is reserved.", UNNAMED_RULE, field);
    }
  },
);

function windowOf(value: unknown): ScheduleWindow | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const start: unknown = Reflect.get(value, "start");
  const end: unknown = Reflect.get(value, "end");
  const note: unknown = Reflect.get(value, "note");

  if (typeof start !== "string" || typeof end !== "string") return undefined;

  return typeof note === "string" ? { start, end, note } : { start, end };
}

const scheduleTaskBody = vine.create(
  vine
    .object({
      start: vine.string(),
      end: vine.string().use(endAfterStart()),
      note: vine.string().optional(),
    })
    .use(windowTooLong())
    .use(unnamedNoteRule()),
);

/** The rules of the `inputRules` api, by operation and part. */
export const inputRules = { scheduleTask: { body: scheduleTaskBody } };
