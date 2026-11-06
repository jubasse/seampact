// The consumer's AdonisJS controllers of the `tasksPaging` api: each implements a generated endpoints interface and
// delegates to the shared paging handlers.
import type * as TasksPagingAdonis from "../generated/server/tasksPaging/index.js";
import type * as TasksPaging from "../generated/types/tasksPaging/index.js";
import { tasksPagingHandlers } from "./paging-handlers.mjs";

export class NotesController implements TasksPagingAdonis.NotesEndpoints {
  listNotes(input: TasksPaging.ListNotesInput) {
    return tasksPagingHandlers.listNotes(input);
  }
}

export class ChangesController implements TasksPagingAdonis.ChangesEndpoints {
  listChanges(input: TasksPaging.ListChangesInput) {
    return tasksPagingHandlers.listChanges(input);
  }
}

export class EventsController implements TasksPagingAdonis.EventsEndpoints {
  listEvents(input: TasksPaging.ListEventsInput) {
    return tasksPagingHandlers.listEvents(input);
  }
}

export class CappedController implements TasksPagingAdonis.CappedEndpoints {
  listCapped(input: TasksPaging.ListCappedInput) {
    return tasksPagingHandlers.listCapped(input);
  }
}
