// The http suite's control routes as a NestJS controller outside the contract, answering from the template's
// framework-neutral control state.
import { Body, Controller, Get, Put, Res } from "@nestjs/common";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import {
  type ControlReply,
  hookCallsReply,
  loadScriptReply,
  logLinesReply,
} from "./suite-control.mjs";

/** The part of the Express response NestJS hands to `@Res()` that a control reply writes. */
interface Response {
  status(code: number): { end(): void; json(body: unknown): void };
}

@Controller()
export class SuiteControlController {
  @Put(SCRIPT_ROUTE)
  loadScript(@Body() body: unknown, @Res() response: Response): void {
    sendControlReply(response, loadScriptReply(body));
  }

  @Get(HOOK_CALLS_ROUTE)
  hookCalls(@Res() response: Response): void {
    sendControlReply(response, hookCallsReply());
  }

  @Get(LOG_LINES_ROUTE)
  logLines(@Res() response: Response): void {
    sendControlReply(response, logLinesReply());
  }
}

function sendControlReply(response: Response, reply: ControlReply): void {
  if (reply.body === undefined) response.status(reply.status).end();
  else response.status(reply.status).json(reply.body);
}
