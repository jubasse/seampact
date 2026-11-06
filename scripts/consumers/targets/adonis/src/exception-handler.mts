// The consumer's app/exceptions/handler: each api's pre-routing helper first, then AdonisJS's own rendering.
import { ExceptionHandler, type HttpContext } from "@adonisjs/core/http";
import * as TasksAdonis from "../generated/server/tasks/index.js";
import * as TasksDevicesAdonis from "../generated/server/tasksDevices/index.js";
import * as TasksPagingAdonis from "../generated/server/tasksPaging/index.js";
import * as TasksResponsesAdonis from "../generated/server/tasksResponses/index.js";
import * as TasksServiceAdonis from "../generated/server/tasksService/index.js";
import * as TasksServiceWritesAdonis from "../generated/server/tasksServiceWrites/index.js";

export default class HttpExceptionHandler extends ExceptionHandler {
  protected override debug = false;

  override async handle(error: unknown, ctx: HttpContext): Promise<unknown> {
    if (await TasksAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksServiceAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksServiceWritesAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksDevicesAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksResponsesAdonis.renderPreRoutingError(error, ctx)) return undefined;

    if (await TasksPagingAdonis.renderPreRoutingError(error, ctx)) return undefined;

    return super.handle(error, ctx);
  }
}
