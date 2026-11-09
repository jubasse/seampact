import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Notes } from "./notes.js";

export function App(): ReactNode {
  const notes = Notes.useListNotes({ query: {} });
  const createNote = Notes.useCreateNote({ onSuccess: () => void refresh() });
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  const refresh = () => queryClient.invalidateQueries();

  if (notes.isPending) return <p>Loading</p>;

  if (notes.isError) return <p role="alert">{notes.error.message}</p>;

  return (
    <main>
      <h1>Notes</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          createNote.mutate({ body: { title } });
          setTitle("");
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
