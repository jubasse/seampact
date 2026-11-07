# Expo and React Native

An Expo or React Native app calls your API with the generated [fetch client](fetch-client.md), and with the [React hooks](react.md) over it (TanStack Query, SWR or RTK Query). Both are written for Hermes and need React Native 0.84 or later.

Capacitor and Ionic apps are web apps: use the React, Angular or Vue targets.

## Generate

Add `@seampact/codegen-ts`, `@seampact/codegen-fetch` and, for hooks, `@seampact/codegen-react` to the targets of your `seampact.config.yaml`, as on the [React page](react.md), then run `npx seampact generate`. The examples below use its target ids, `client` and `queries`. The client has no runtime dependency.

## Create the client

Read the API address from `EXPO_PUBLIC_API_URL` in `.env`. Expo inlines it at build time.

```ts
// client.ts
import * as NotesClient from "./__generated__/client/notes";

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

if (baseUrl === undefined) throw new Error("Set EXPO_PUBLIC_API_URL.");

export const client = NotesClient.createClient({ baseUrl });
```

Write `process.env.EXPO_PUBLIC_API_URL` exactly like this: Expo does not replace a destructured or bracketed read.

Use a device address, not `localhost`, when you test on a phone: your machine's IP, or `10.0.2.2` on the Android emulator.

## Idempotency keys

Hermes has no `crypto.randomUUID`. A contract with an idempotent operation makes `createClient` refuse to start, and says so: pass a key generator.

```sh
npx expo install expo-crypto
```

```ts
// client.ts
import { randomUUID } from "expo-crypto";

export const client = NotesClient.createClient({ baseUrl, idempotencyKey: randomUUID });
```

The hooks take the same function as the second argument of `createNotesHooks` (below).

## Hooks

The hooks work as on the web. With TanStack Query:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { Text } from "react-native";
import { createNotesHooks } from "./__generated__/queries/notes";
import { client } from "./client";

const Notes = createNotesHooks(client, { idempotencyKey: randomUUID });
const queryClient = new QueryClient();

function NoteList() {
  const notes = Notes.useListNotes({});

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

## What to know about Hermes

- `crypto.randomUUID` is missing: pass `idempotencyKey`, as above.
- `createClient` refuses to start on React Native before 0.84 when your contract reads a cursor from a `Link` header, because `URLSearchParams.get` is missing there. Update, or add a `URLSearchParams` polyfill such as `react-native-url-polyfill`.
- An injected `fetch` also works, for example `expo/fetch`: pass it as `fetch` in the client config.

A unit test runs the client and the hook runtime in Node with those globals removed, the way Hermes lacks them. No Expo app runs in CI.

## Limits

The client and hooks refuse the same forms as on the web: see [Generate errors](../troubleshooting/generate.md#clients).

## Next

[Point the client at your backend](backend-url.md), or [React](react.md) for the options of the hooks.
