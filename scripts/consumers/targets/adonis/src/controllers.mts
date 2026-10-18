// The consumer's AdonisJS controllers: plain classes, each implementing a generated endpoints interface and
// delegating to the shared handlers. The routes import them lazily, as AdonisJS apps import controllers.
import type * as TasksAdonis from "../generated/server/tasks/index.js";
import type * as TasksServiceAdonis from "../generated/server/tasksService/index.js";
import type * as Tasks from "../generated/types/tasks/index.js";
import type * as TasksService from "../generated/types/tasksService/index.js";
import { tasksHandlers, tasksServiceHandlers } from "./handlers.mjs";

export class AppController implements TasksAdonis.AppEndpoints {
  health(_input: Tasks.HealthInput) {
    return tasksHandlers.health();
  }
}

export class ChannelsController implements TasksAdonis.ChannelsEndpoints {
  listChannels(input: Tasks.ListChannelsInput) {
    return tasksHandlers.listChannels(input);
  }

  getChannel(input: Tasks.GetChannelInput) {
    return tasksHandlers.getChannel(input);
  }
}

export class TasksController implements TasksAdonis.TasksEndpoints {
  listTasks(input: Tasks.ListTasksInput) {
    return tasksHandlers.listTasks(input);
  }

  createTask(input: Tasks.CreateTaskInput) {
    return tasksHandlers.createTask(input);
  }

  getTasksBatch(input: Tasks.GetTasksBatchInput) {
    return tasksHandlers.getTasksBatch(input);
  }

  searchTasks(input: Tasks.SearchTasksInput) {
    return tasksHandlers.searchTasks(input);
  }

  getTask(input: Tasks.GetTaskInput) {
    return tasksHandlers.getTask(input);
  }

  updateTask(input: Tasks.UpdateTaskInput) {
    return tasksHandlers.updateTask(input);
  }

  archiveTask(input: Tasks.ArchiveTaskInput) {
    return tasksHandlers.archiveTask(input);
  }

  assignTask(input: Tasks.AssignTaskInput) {
    return tasksHandlers.assignTask(input);
  }

  purgeTask(input: Tasks.PurgeTaskInput) {
    return tasksHandlers.purgeTask(input);
  }
}

export class DraftsController implements TasksAdonis.DraftsEndpoints {
  getDraft(input: Tasks.GetDraftInput) {
    return tasksHandlers.getDraft(input);
  }

  deleteDraft(input: Tasks.DeleteDraftInput) {
    return tasksHandlers.deleteDraft(input);
  }
}

export class PreferencesController implements TasksAdonis.PreferencesEndpoints {
  getPreferences(input: Tasks.GetPreferencesInput) {
    return tasksHandlers.getPreferences(input);
  }

  updatePreferences(input: Tasks.UpdatePreferencesInput) {
    return tasksHandlers.updatePreferences(input);
  }
}

export class HooksController implements TasksAdonis.HooksEndpoints {
  payments(input: Tasks.PaymentsInput) {
    return tasksHandlers.payments(input);
  }
}

export class InternalController implements TasksServiceAdonis.InternalEndpoints {
  getTask(input: TasksService.GetTaskInput) {
    return tasksServiceHandlers.getTask(input);
  }
}
