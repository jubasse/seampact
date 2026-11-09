import { z } from "zod";

// The one rule the contract cannot say: a title of only spaces passes `minLength: 1`, so the app refuses it.
const createNoteBody = z
  .object({ title: z.string() })
  .refine((note) => note.title.trim().length > 0, {
    path: ["title"],
    params: { rule: "titleNotBlank" },
  });

/** The app's rules, by operation and part. A refusal answers 400 with the pointer `/title` and the rule `app.titleNotBlank`. */
export const inputRules = { createNote: { body: createNoteBody } };
