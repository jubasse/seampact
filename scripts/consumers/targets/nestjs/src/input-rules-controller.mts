// The consumer's NestJS controller of the `inputRules` api: it implements the generated endpoints interface, marks its
// method with the generated operation decorator and delegates to the shared handler, which the app input rules guard.
import { Controller } from "@nestjs/common";
import * as InputRulesNest from "../generated/server/inputRules/index.js";
import type * as InputRules from "../generated/types/inputRules/index.js";
import { inputRulesHandlers } from "./input-rules-handlers.mjs";

@Controller()
export class InputRulesController implements InputRulesNest.AppEndpoints {
  @InputRulesNest.scheduleTask()
  scheduleTask(@InputRulesNest.scheduleTask.input() input: InputRules.ScheduleTaskInput) {
    return inputRulesHandlers.scheduleTask(input);
  }
}
