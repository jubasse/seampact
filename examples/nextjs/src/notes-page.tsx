"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { NotesHooks } from "./notes";

function NotesList(): ReactNode {
  const notes = NotesHooks.useListNotes({ query: {} });
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const createNote = NotesHooks.useCreateNote({
    onSuccess: () => {
      setTitle("");

      return queryClient.invalidateQueries();
    },
  });

  if (notes.isPending) return <p>Loading</p>;

  if (notes.isError) return <p role="alert">{notes.error.message}</p>;

  return (
    <main>
      <h1>Notes</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          createNote.mutate({ body: { title } });
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit">Add</button>
      </form>
      {createNote.isError ? <p role="alert">{createNote.error.message}</p> : null}
      <ul>
        {notes.data.body.items.map((note) => (
          <li key={note.noteId}>{note.title}</li>
        ))}
      </ul>
    </main>
  );
}

export function Notes(): ReactNode {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <NotesList />
    </QueryClientProvider>
  );
}
