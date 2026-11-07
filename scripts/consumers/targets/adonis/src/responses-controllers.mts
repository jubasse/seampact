// The consumer's AdonisJS controllers of the `tasksResponses` api: each implements a generated endpoints interface
// and delegates to the shared handlers.
import type * as TasksResponsesAdonis from "../generated/server/tasksResponses/index.js";
import type * as TasksResponses from "../generated/types/tasksResponses/index.js";
import { tasksResponsesHandlers } from "./responses-handlers.mjs";

export class ResponsesController implements TasksResponsesAdonis.ResponsesEndpoints {
  digest(input: TasksResponses.DigestInput) {
    return tasksResponsesHandlers.digest(input);
  }
}

export class NotesController implements TasksResponsesAdonis.NotesEndpoints {
  getNote(input: TasksResponses.GetNoteInput) {
    return tasksResponsesHandlers.getNote(input);
  }

  updateNote(input: TasksResponses.UpdateNoteInput) {
    return tasksResponsesHandlers.updateNote(input);
  }

  saveNote(input: TasksResponses.SaveNoteInput) {
    return tasksResponsesHandlers.saveNote(input);
  }

  keyNote(input: TasksResponses.KeyNoteInput) {
    return tasksResponsesHandlers.keyNote(input);
  }

  legacyNote(input: TasksResponses.LegacyNoteInput) {
    return tasksResponsesHandlers.legacyNote(input);
  }
}

export class MemosController implements TasksResponsesAdonis.MemosEndpoints {
  getMemo(input: TasksResponses.GetMemoInput) {
    return tasksResponsesHandlers.getMemo(input);
  }

  deleteMemo(input: TasksResponses.DeleteMemoInput) {
    return tasksResponsesHandlers.deleteMemo(input);
  }
}
