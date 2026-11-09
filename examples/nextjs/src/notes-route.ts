import { inputRules } from "./input-rules";
import { notesEndpoints } from "./notes-handlers";

// A public api needs no hooks.
export const notesRouteOptions = {
  handlers: { NotesEndpoints: notesEndpoints },
  inputRules,
};
