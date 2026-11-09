// The `input-rules` case's app input rules in zod: the refinement's `params.rule` names the rule, and the unnamed
// one gives none. The consumer harness copies this file to `src/input-rules.mts` when the validators are zod.
import { z } from "zod";
import { endsAfterStart, noteIsNamed, windowWithinLimit } from "./input-rules-handlers.mjs";

const scheduleTaskBody = z
  .object({ start: z.string(), end: z.string(), note: z.string().optional() })
  .refine(endsAfterStart, { path: ["end"], params: { rule: "endAfterStart" } })
  .refine(windowWithinLimit, { params: { rule: "windowTooLong" } })
  .refine(noteIsNamed);

/** The rules of the `inputRules` api, by operation and part. */
export const inputRules = { scheduleTask: { body: scheduleTaskBody } };
