// The `tasksPaging` api's handlers and hooks, which every Node server consumer registers beside the main apis: a
// changes feed with its next token, a stale token and an instant one, and a Stripe-style list with its more flag.
// Each note's text tells what the handler received, so a case reads it on the wire.
import type * as TasksPaging from "../generated/types/tasksPaging/index.js";
import { logUnexpectedError, userAuthenticateHook } from "./hooks.mjs";

const FIRST_NOTE_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_NOTE_ID = "30000000-0000-4000-8000-000000000002";
const NEXT_CHANGES_TOKEN = "changes-2";
const NEXT_EVENTS_INSTANT = "2026-10-18T10:00:00Z";

// A token the feed no longer serves answers the `gone` role's code.
const STALE_TOKEN = { status: 410, code: "api.cursor_too_old" } as const;

/** The `tasksPaging` api's handlers, by operation. */
export const tasksPagingHandlers = {
  listNotes(input: TasksPaging.ListNotesInput): TasksPaging.ListNotesOutput {
    if (input.query.starting_after === FIRST_NOTE_ID) {
      return {
        status: 200,
        body: { items: [{ noteId: SECOND_NOTE_ID, text: "Second note" }], more: false },
      };
    }

    return {
      status: 200,
      body: { items: [{ noteId: FIRST_NOTE_ID, text: "First note" }], more: true },
    };
  },

  listChanges(
    input: TasksPaging.ListChangesInput,
  ): TasksPaging.ListChangesOutput | typeof STALE_TOKEN {
    const since = input.query.since;

    if (since === NEXT_CHANGES_TOKEN) {
      return { status: 200, body: { items: [], nextSince: NEXT_CHANGES_TOKEN, complete: true } };
    }

    if (since !== undefined) return STALE_TOKEN;

    return {
      status: 200,
      body: {
        items: [{ noteId: FIRST_NOTE_ID, text: `limit ${String(input.query.limit)}` }],
        nextSince: NEXT_CHANGES_TOKEN,
        complete: false,
      },
    };
  },

  listEvents(_input: TasksPaging.ListEventsInput): TasksPaging.ListEventsOutput {
    return {
      status: 200,
      body: {
        items: [{ noteId: FIRST_NOTE_ID, text: "Changed since the token" }],
        nextSince: NEXT_EVENTS_INSTANT,
        complete: true,
      },
    };
  },
};

/** The `tasksPaging` api's hooks: the user identity alone. */
export function tasksPagingHooks() {
  return {
    authenticate: { user: userAuthenticateHook },
    deciders: [],
    scopeResolvers: {},
    onUnexpectedError: logUnexpectedError,
  };
}
