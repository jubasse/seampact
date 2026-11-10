// The consumer's AdonisJS controller of the `inputRules` api: it implements the generated endpoints interface and
// delegates to the shared handler, which the app input rules of `input-rules.mts` guard.
import type * as InputRulesAdonis from "../generated/server/inputRules/index.js";
import type * as InputRules from "../generated/types/inputRules/index.js";
import { inputRulesHandlers } from "./input-rules-handlers.mjs";

export class InputRulesController implements InputRulesAdonis.AppEndpoints {
  scheduleTask(input: InputRules.ScheduleTaskInput) {
    return inputRulesHandlers.scheduleTask(input);
  }
}
