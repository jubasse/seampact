// The consumer's NestJS controllers: each implements a generated endpoints interface, marks its methods with the
// generated operation decorators and delegates to the shared handlers.
import { Controller } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import type * as Tasks from "../generated/types/tasks/index.js";
import type * as TasksService from "../generated/types/tasksService/index.js";
import { tasksHandlers, tasksServiceHandlers } from "./handlers.mjs";

@Controller()
export class AppController implements TasksNest.AppEndpoints {
  @TasksNest.health()
  health(@TasksNest.health.input() _input: Tasks.HealthInput) {
    return tasksHandlers.health();
  }
}

@Controller()
export class ChannelsController implements TasksNest.ChannelsEndpoints {
  @TasksNest.listChannels()
  listChannels(@TasksNest.listChannels.input() input: Tasks.ListChannelsInput) {
    return tasksHandlers.listChannels(input);
  }

  @TasksNest.getChannel()
  getChannel(
    @TasksNest.getChannel.input() input: TasksNest.HandlerInputs["getChannel"],
    @TasksNest.getChannel.principal()
    principal: TasksNest.OperationAccess["getChannel"]["principal"],
    @TasksNest.getChannel.scopes() scopes: TasksNest.OperationAccess["getChannel"]["scopes"],
  ) {
    if (principal !== input.principal || scopes.channel.id !== input.scopes.channel.id) {
      throw new Error("the principal and scopes decorators disagree with the input");
    }

    return tasksHandlers.getChannel(input);
  }
}

@Controller()
export class TasksController implements TasksNest.TasksEndpoints {
  @TasksNest.listTasks()
  listTasks(@TasksNest.listTasks.input() input: Tasks.ListTasksInput) {
    return tasksHandlers.listTasks(input);
  }

  @TasksNest.createTask()
  createTask(@TasksNest.createTask.input() input: Tasks.CreateTaskInput) {
    return tasksHandlers.createTask(input);
  }

  @TasksNest.getTasksBatch()
  getTasksBatch(@TasksNest.getTasksBatch.input() input: Tasks.GetTasksBatchInput) {
    return tasksHandlers.getTasksBatch(input);
  }

  @TasksNest.searchTasks()
  searchTasks(@TasksNest.searchTasks.input() input: Tasks.SearchTasksInput) {
    return tasksHandlers.searchTasks(input);
  }

  @TasksNest.getTask()
  getTask(@TasksNest.getTask.input() input: Tasks.GetTaskInput) {
    return tasksHandlers.getTask(input);
  }

  @TasksNest.updateTask()
  updateTask(@TasksNest.updateTask.input() input: Tasks.UpdateTaskInput) {
    return tasksHandlers.updateTask(input);
  }

  @TasksNest.archiveTask()
  archiveTask(@TasksNest.archiveTask.input() input: Tasks.ArchiveTaskInput) {
    return tasksHandlers.archiveTask(input);
  }

  @TasksNest.assignTask()
  assignTask(@TasksNest.assignTask.input() input: Tasks.AssignTaskInput) {
    return tasksHandlers.assignTask(input);
  }

  @TasksNest.purgeTask()
  purgeTask(@TasksNest.purgeTask.input() input: Tasks.PurgeTaskInput) {
    return tasksHandlers.purgeTask(input);
  }
}

@Controller()
export class DraftsController implements TasksNest.DraftsEndpoints {
  @TasksNest.getDraft()
  getDraft(@TasksNest.getDraft.input() input: Tasks.GetDraftInput) {
    return tasksHandlers.getDraft(input);
  }

  @TasksNest.deleteDraft()
  deleteDraft(@TasksNest.deleteDraft.input() input: Tasks.DeleteDraftInput) {
    return tasksHandlers.deleteDraft(input);
  }
}

@Controller()
export class PreferencesController implements TasksNest.PreferencesEndpoints {
  @TasksNest.getPreferences()
  getPreferences(@TasksNest.getPreferences.input() input: Tasks.GetPreferencesInput) {
    return tasksHandlers.getPreferences(input);
  }

  @TasksNest.updatePreferences()
  updatePreferences(@TasksNest.updatePreferences.input() input: Tasks.UpdatePreferencesInput) {
    return tasksHandlers.updatePreferences(input);
  }
}

@Controller()
export class HooksController implements TasksNest.HooksEndpoints {
  @TasksNest.payments()
  payments(@TasksNest.payments.input() input: Tasks.PaymentsInput) {
    return tasksHandlers.payments(input);
  }
}

@Controller()
export class InternalController implements TasksServiceNest.InternalEndpoints {
  @TasksServiceNest.getTask()
  getTask(@TasksServiceNest.getTask.input() input: TasksService.GetTaskInput) {
    return tasksServiceHandlers.getTask(input);
  }
}
