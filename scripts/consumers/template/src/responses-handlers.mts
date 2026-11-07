// The `tasksResponses` api's handlers and hooks, which every Node server consumer registers beside the other apis:
// one note at its first revision, saved as 200 when it exists and 201 otherwise, and the If-Match comparison the
// boundary leaves to the handler; one memo at its first version, which a delete with another expected version leaves.
import type * as TasksResponses from "../generated/types/tasksResponses/index.js";
import { scripted } from "./handlers.mjs";
import { createIdempotencyStore, logUnexpectedError, userAuthenticateHook } from "./hooks.mjs";

const NOTE_ID = "30000000-0000-4000-8000-000000000001";
const FIRST_REVISION = 1;
const NOTE_SECRET = "note-secret";
const STALE_TAG = { status: 412, code: "api.precondition_failed" } as const;
const FIRST_MEMO_VERSION = 1;
const STALE_MEMO_VERSION = { status: 409, code: "state.conflict" } as const;

function note(noteId: string, text = "The first note"): TasksResponses.schemas.Note {
  return { noteId, text, revision: FIRST_REVISION };
}

/** The `tasksResponses` api's handlers, by operation. */
export const tasksResponsesHandlers = scripted("tasksResponses", {
  digest(_input: TasksResponses.DigestInput): TasksResponses.DigestOutput {
    return { status: 200, body: note(NOTE_ID, "Today's digest") };
  },

  getNote(input: TasksResponses.GetNoteInput): TasksResponses.GetNoteOutput {
    return { status: 200, body: note(input.path.noteId) };
  },

  updateNote(
    input: TasksResponses.UpdateNoteInput,
  ): TasksResponses.UpdateNoteOutput | typeof STALE_TAG {
    // The boundary hands the If-Match version unquoted (`1` for `"1"` or `W/"1"`).
    if (input.headers["if-match"] !== String(FIRST_REVISION)) return STALE_TAG;

    return {
      status: 200,
      body: { noteId: input.path.noteId, text: input.body.text, revision: FIRST_REVISION + 1 },
    };
  },

  saveNote(input: TasksResponses.SaveNoteInput): TasksResponses.SaveNoteOutput {
    const saved = { noteId: input.path.noteId, text: input.body.text, revision: FIRST_REVISION };

    return input.path.noteId === NOTE_ID
      ? { status: 200, body: saved }
      : { status: 201, body: saved };
  },

  keyNote(input: TasksResponses.KeyNoteInput): TasksResponses.KeyNoteOutput {
    return { status: 200, body: { noteId: input.path.noteId, secret: NOTE_SECRET } };
  },

  legacyNote(input: TasksResponses.LegacyNoteInput): TasksResponses.LegacyNoteOutput {
    return { status: 200, body: note(input.path.noteId) };
  },

  getMemo(input: TasksResponses.GetMemoInput): TasksResponses.GetMemoOutput {
    return {
      status: 200,
      body: { memoId: input.path.memoId, text: "The first memo", version: FIRST_MEMO_VERSION },
    };
  },

  deleteMemo(
    input: TasksResponses.DeleteMemoInput,
  ): TasksResponses.DeleteMemoOutput | typeof STALE_MEMO_VERSION {
    if (input.query.expectedVersion !== FIRST_MEMO_VERSION) return STALE_MEMO_VERSION;

    return { status: 204 };
  },
});

/** The `tasksResponses` api's hooks: the user identity, and an idempotency store for its writes. */
export function tasksResponsesHooks() {
  return {
    authenticate: { user: userAuthenticateHook },
    deciders: [],
    scopeResolvers: {},
    idempotencyStore: createIdempotencyStore(),
    onUnexpectedError: logUnexpectedError,
  };
}
