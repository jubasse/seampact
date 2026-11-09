import { createClient } from "./__generated__/client/notes";
import { createNotesHooks } from "./__generated__/queries/notes";

// The backend URL is an argument, never generated: Next.js reads it from NEXT_PUBLIC_API_URL (see `.env.example`).
// The reference must be written exactly like this for Next.js to bake it into the browser bundle.
const baseUrl = process.env.NEXT_PUBLIC_API_URL;

if (baseUrl === undefined) throw new Error("NEXT_PUBLIC_API_URL is not set: see `.env.example`.");

const client = createClient({ baseUrl });

export const NotesHooks = createNotesHooks(client);
