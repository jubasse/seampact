// The `input-rules` case's app input rules in yup: the test's `name` names the rule, and the unnamed one has none.
// The consumer harness copies this file to `src/input-rules.mts` when the validators are yup.
import { object, string } from "yup";
import { endsAfterStart, noteIsNamed, windowWithinLimit } from "./input-rules-handlers.mjs";

const scheduleTaskBody = object({
  start: string().required(),
  end: string().required(),
  note: string(),
})
  .test({
    name: "endAfterStart",
    test: (window, context) => endsAfterStart(window) || context.createError({ path: "end" }),
  })
  .test({ name: "windowTooLong", test: windowWithinLimit })
  .test(noteIsNamed);

/** The rules of the `inputRules` api, by operation and part. */
export const inputRules = { scheduleTask: { body: scheduleTaskBody } };
