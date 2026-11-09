import { createClient } from "../__generated__/client/notes/index.js";
import { createNotesHooks } from "../__generated__/queries/notes/index.js";

// The backend URL is an argument, never generated: Vite reads it from VITE_API_URL (see `.env.example`).
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });

export const Notes = createNotesHooks(client);
