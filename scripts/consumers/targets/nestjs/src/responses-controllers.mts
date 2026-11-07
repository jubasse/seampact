// The consumer's NestJS controllers of the `tasksResponses` api: each implements a generated endpoints interface,
// marks its methods with the generated operation decorators and delegates to the shared handlers.
import { Controller } from "@nestjs/common";
import * as TasksResponsesNest from "../generated/server/tasksResponses/index.js";
import type * as TasksResponses from "../generated/types/tasksResponses/index.js";
import { tasksResponsesHandlers } from "./responses-handlers.mjs";

@Controller()
export class ResponsesController implements TasksResponsesNest.ResponsesEndpoints {
  @TasksResponsesNest.digest()
  digest(@TasksResponsesNest.digest.input() input: TasksResponses.DigestInput) {
    return tasksResponsesHandlers.digest(input);
  }
}

@Controller()
export class ResponsesNotesController implements TasksResponsesNest.NotesEndpoints {
  @TasksResponsesNest.getNote()
  getNote(@TasksResponsesNest.getNote.input() input: TasksResponses.GetNoteInput) {
    return tasksResponsesHandlers.getNote(input);
  }

  @TasksResponsesNest.updateNote()
  updateNote(@TasksResponsesNest.updateNote.input() input: TasksResponses.UpdateNoteInput) {
    return tasksResponsesHandlers.updateNote(input);
  }

  @TasksResponsesNest.saveNote()
  saveNote(@TasksResponsesNest.saveNote.input() input: TasksResponses.SaveNoteInput) {
    return tasksResponsesHandlers.saveNote(input);
  }

  @TasksResponsesNest.keyNote()
  keyNote(@TasksResponsesNest.keyNote.input() input: TasksResponses.KeyNoteInput) {
    return tasksResponsesHandlers.keyNote(input);
  }

  @TasksResponsesNest.legacyNote()
  legacyNote(@TasksResponsesNest.legacyNote.input() input: TasksResponses.LegacyNoteInput) {
    return tasksResponsesHandlers.legacyNote(input);
  }
}

@Controller()
export class ResponsesMemosController implements TasksResponsesNest.MemosEndpoints {
  @TasksResponsesNest.getMemo()
  getMemo(@TasksResponsesNest.getMemo.input() input: TasksResponses.GetMemoInput) {
    return tasksResponsesHandlers.getMemo(input);
  }

  @TasksResponsesNest.deleteMemo()
  deleteMemo(@TasksResponsesNest.deleteMemo.input() input: TasksResponses.DeleteMemoInput) {
    return tasksResponsesHandlers.deleteMemo(input);
  }
}
