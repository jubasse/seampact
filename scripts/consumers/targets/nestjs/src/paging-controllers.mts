// The consumer's NestJS controllers of the `tasksPaging` api: each implements a generated endpoints interface, marks
// its method with the generated operation decorator and delegates to the shared paging handlers.
import { Controller } from "@nestjs/common";
import * as TasksPagingNest from "../generated/server/tasksPaging/index.js";
import type * as TasksPaging from "../generated/types/tasksPaging/index.js";
import { tasksPagingHandlers } from "./paging-handlers.mjs";

@Controller()
export class NotesController implements TasksPagingNest.NotesEndpoints {
  @TasksPagingNest.listNotes()
  listNotes(@TasksPagingNest.listNotes.input() input: TasksPaging.ListNotesInput) {
    return tasksPagingHandlers.listNotes(input);
  }
}

@Controller()
export class ChangesController implements TasksPagingNest.ChangesEndpoints {
  @TasksPagingNest.listChanges()
  listChanges(@TasksPagingNest.listChanges.input() input: TasksPaging.ListChangesInput) {
    return tasksPagingHandlers.listChanges(input);
  }
}

@Controller()
export class EventsController implements TasksPagingNest.EventsEndpoints {
  @TasksPagingNest.listEvents()
  listEvents(@TasksPagingNest.listEvents.input() input: TasksPaging.ListEventsInput) {
    return tasksPagingHandlers.listEvents(input);
  }
}

@Controller()
export class CappedController implements TasksPagingNest.CappedEndpoints {
  @TasksPagingNest.listCapped()
  listCapped(@TasksPagingNest.listCapped.input() input: TasksPaging.ListCappedInput) {
    return tasksPagingHandlers.listCapped(input);
  }
}
