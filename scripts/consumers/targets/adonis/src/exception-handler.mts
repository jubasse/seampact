// The consumer's app/exceptions/handler: each api's pre-routing helper first, then AdonisJS's own rendering.
import { ExceptionHandler, type HttpContext } from "@adonisjs/core/http";
import * as TasksAdonis from "../generated/server/tasks/index.js";
import * as TasksServiceAdonis from "../generated/server/tasksService/index.js";

export default class HttpExceptionHandler extends ExceptionHandler {
  protected override debug = false;

  override async handle(error: unknown, ctx: HttpContext): Promise<unknown> {
    if (await TasksAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksServiceAdonis.renderPreRoutingError(error, ctx)) return undefined;

    return super.handle(error, ctx);
  }
}
