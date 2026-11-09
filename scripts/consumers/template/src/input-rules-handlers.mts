// The `inputRules` api's handler, which the servers that enable the `input-rules` case register with the app input
// rules of `input-rules.mts`, and what those rules check, library-neutral: each library's file writes the same three
// rules (ADR 0028 "Tests").
import { inputRuleHookName } from "@seampact/http-suite";
import type * as InputRules from "../generated/types/inputRules/index.js";
import { scripted } from "./handlers.mjs";
import { throwScriptedHookFailure } from "./suite-control.mjs";

const SCHEDULED_TASK_ID = "40000000-0000-4000-8000-000000000001";
const DAY_MS = 86_400_000;
const LONGEST_WINDOW_DAYS = 90;

/** The note that makes the unnamed rule refuse, so the case reaches a rule without a usable name. */
export const UNNAMED_RULE_NOTE = "unnamed";

/** A body the rules read: the dates and the note, as each library hands them. */
export interface ScheduleWindow {
  readonly start: string;
  readonly end: string;
  readonly note?: string | undefined;
}

/** The `inputRules` api's handlers, by operation. */
export const inputRulesHandlers = scripted("inputRules", {
  scheduleTask(input: InputRules.ScheduleTaskInput): InputRules.ScheduleTaskOutput {
    return {
      status: 201,
      body: { taskId: SCHEDULED_TASK_ID, start: input.body.start, end: input.body.end },
    };
  },
});

/** `endAfterStart`: the end comes after the start. It throws what the script gives it, for the 500 step. */
export function endsAfterStart(window: ScheduleWindow): boolean {
  throwScriptedHookFailure(inputRuleHookName("endAfterStart"));

  return window.end > window.start;
}

/** `windowTooLong`: the window spans at most 90 days; a cross-member rule with no path. */
export function windowWithinLimit(window: ScheduleWindow): boolean {
  const windowMs = Date.parse(window.end) - Date.parse(window.start);

  return windowMs <= LONGEST_WINDOW_DAYS * DAY_MS;
}

/** The rule without a usable name: it refuses the note {@link UNNAMED_RULE_NOTE} only. */
export function noteIsNamed(window: ScheduleWindow): boolean {
  return window.note !== UNNAMED_RULE_NOTE;
}
