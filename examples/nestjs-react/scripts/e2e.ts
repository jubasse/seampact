// Starts the server on a free port and calls it with the generated client, as the React app does.
import { createClient } from "../src/__generated__/client/notes/index.js";
import { startServer } from "../src/server/start-server.js";

const app = await startServer(0);

try {
  const address = app.getHttpServer().address();

  if (typeof address !== "object" || address === null)
    throw new Error("The server does not listen on a TCP port.");

  const client = createClient({ baseUrl: `http://127.0.0.1:${address.port}` });
  const created = await client.createNote({ body: { title: "First note" } });

  if (!created.ok) throw new Error(`createNote answered ${created.status}.`);

  const listed = await client.listNotes({ query: {} });

  if (!listed.ok || listed.body.items.length !== 1)
    throw new Error("listNotes did not return the created note.");

  // The app rule of src/server/input-rules.ts: a title of spaces passes the contract but not the rule.
  const blank = await client.createNote({ body: { title: "   " } });

  if (blank.ok || blank.status !== 400) throw new Error("A blank title was not refused with 400.");

  console.log("e2e ok: create, list and the titleNotBlank rule");
} finally {
  await app.close();
}
