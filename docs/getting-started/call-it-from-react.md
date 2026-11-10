# Call it from React

The same contract generates a typed client for your frontend. Here a React app lists and creates notes through TanStack Query hooks. You need the notes API from [Your first API](your-first-api.md), running on port 3000. The client reads only the contract folder, so the server behind it can be any of the eleven. The commands use `npx` for Node: see [commands per stack](../features/commands-per-stack.md). For Vue, Angular or Expo, follow the same steps with [Vue](../frontend/vue.md), [Angular](../frontend/angular.md) or [Expo](../frontend/mobile.md).

## 1. Create the React app

Next to `notes-app`, create a Vite app and install seampact in it.

```sh
npm create vite@latest notes-web -- --template react-ts
cd notes-web
npm install
npm install @tanstack/react-query
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-fetch @seampact/codegen-react
```

Each app has its own `seampact.config.yaml`. This one reads the contract of the backend and generates three targets. Create it in `notes-web`.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ../notes-app/contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: client
    use: "@seampact/codegen-fetch"
    apis: [notes]
    link: { types: types }
  - id: queries
    use: "@seampact/codegen-react"
    apis: [notes]
    options: { query: tanstack }
    link: { client: client }
```

- `client` is the typed `fetch` client. Its functions come from [the fetch client](../frontend/fetch-client.md).
- `queries` writes the React hooks over that client. `query: tanstack` picks TanStack Query; SWR and RTK Query work too, see [React](../frontend/react.md).

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`.

## 2. Reach the backend

The browser calls `localhost:5173` and the API lives on `localhost:3000`. Let Vite forward the contract's paths, so the browser sees one origin and needs no CORS setup. Replace `vite.config.ts`.

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/v1": "http://localhost:3000" } },
});
```

For a deployed app, see [Point the client at your backend](../frontend/backend-url.md).

## 3. Use the hooks

Replace `src/App.tsx`.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import * as NotesClient from "./__generated__/client/notes";
import { createNotesHooks } from "./__generated__/queries/notes";

const client = NotesClient.createClient({ baseUrl: "" });
const Notes = createNotesHooks(client);
const queryClient = new QueryClient();

function NoteList() {
  const [title, setTitle] = useState("");
  const notes = Notes.useListNotes({});
  const createNote = Notes.useCreateNote();

  return (
    <div>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button onClick={() => createNote.mutate({ body: { title } })}>Add</button>
      <ul>
        {notes.data?.body.items.map((note) => (
          <li key={note.noteId}>{note.title}</li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NoteList />
    </QueryClientProvider>
  );
}
```

- `createClient` takes the backend URL. An empty one keeps the paths relative, so the Vite proxy answers.
- `createNotesHooks(client)` gives one hook per operation: `useListNotes`, `useCreateNote`, `useGetNote` and `useDeleteNote`.
- After `createNote`, the hooks refresh the list on their own.

Start the app and open the address it prints.

```sh
npm run dev
```

You see an empty list. Type a title and click Add: the note appears. The server refuses an empty title with a 400, and the hook's `error` holds it.

## Without hooks

The client alone gives you each reply as data, with no library.

```ts
const reply = await client.listNotes({});

if (reply.ok) console.log(reply.status, reply.body.items);
```

Errors, `errorStyle` and `idempotencyKey` are in [the fetch client](../frontend/fetch-client.md). To send the calls through your own axios instance, see the [axios client](../frontend/axios-client.md).

Next: [check it in CI](../features/check-in-ci.md), so the generated files in both apps never drift from the contract.
