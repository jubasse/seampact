# Expo and React Native

An Expo or React Native app calls your API with the generated `fetch` client, and with the React hooks over it (TanStack Query, SWR or RTK Query). Both run on Hermes.

Capacitor and Ionic apps are web apps: use the React, Angular or Vue targets.

## Generate

Add `@seampact/codegen-ts`, `@seampact/codegen-fetch` and, for hooks, `@seampact/codegen-react` to the targets of your `seampact.config.yaml`, then run `seampact generate`. The client has no runtime dependency.

## Create the client

Read the API address from `EXPO_PUBLIC_API_URL` in `.env`. Expo inlines it at build time.

```ts
import * as NotesClient from "./generated/notes/client";

export const client = NotesClient.createClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
});
```

Use a device address, not `localhost`, when you test on a phone: your machine's IP, or `10.0.2.2` on the Android emulator.

## Idempotency keys

Hermes has no `crypto.randomUUID`. A contract with an idempotent operation makes `createClient` refuse to start, and says so: pass a key generator.

```ts
import { randomUUID } from "expo-crypto";

export const client = NotesClient.createClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
  idempotencyKey: randomUUID,
});
```

Hooks take the same function as `settings.idempotencyKey`.

## Hooks

The hooks work as on the web. With TanStack Query:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createNotesHooks } from "./generated/notes/hooks";
import { client } from "./client";

const Notes = createNotesHooks(client, { idempotencyKey: randomUUID });
const queryClient = new QueryClient();

function NoteList() {
  const notes = Notes.useListNotes();

  return notes.data ? <Text>{notes.data.body.items.length} notes</Text> : null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NoteList />
    </QueryClientProvider>
  );
}
```

SWR and RTK Query hooks are used the same way, with their own provider.

## What the client needs from Hermes

| Web API | On Hermes | In the client |
|---|---|---|
| `fetch`, `Headers`, `Response`, `AbortController` | provided by React Native | used; a missing `fetch` is refused at creation, pass `fetch` |
| `crypto.randomUUID` | missing | refused at creation, pass `idempotencyKey` |
| `AbortSignal.timeout`, `AbortSignal.any` | missing | an `AbortController` stands in |
| `URL.canParse` | missing | not used |
| `TextEncoder`, `FormData`, `Blob`, `structuredClone`, `ReadableStream` | not needed | not used |

An injected `fetch` also works, for example `expo/fetch`.

## Tested and not tested

A unit test runs the generated client and the hook runtime in Node with those globals removed, the way Hermes lacks them. There is no Expo app in CI: the real `URL` and `URLSearchParams` of React Native, and the hooks inside a running app, are not tested.
