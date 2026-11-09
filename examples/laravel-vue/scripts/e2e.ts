// Starts the Laravel app on a free port and calls it with the generated client, as the Vue app does.
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/__generated__/client/notes/index.js";
import { freePort, startPhpServer } from "./php-server.js";

const notesFile = join(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  "api/storage/notes.json",
);

// A run starts from an empty store.
rmSync(notesFile, { force: true });

const server = await startPhpServer(await freePort());

try {
  const client = createClient({ baseUrl: server.baseUrl });
  const created = await client.createNote({ body: { title: "First note" } });

  if (!created.ok) throw new Error(`createNote answered ${created.status}.`);

  const listed = await client.listNotes({ query: {} });

  if (!listed.ok || listed.body.items.length !== 1)
    throw new Error("listNotes did not return the created note.");

  // The app rule of api/app/Rules: a title of spaces passes the contract but not the rule.
  const blank = await client.createNote({ body: { title: "   " } });

  if (blank.ok || blank.unexpected || blank.code !== "api.schema_invalid")
    throw new Error("A blank title was not refused with api.schema_invalid.");

  const [issue] = blank.params.issues;

  if (blank.status !== 400 || issue?.pointer !== "/title" || issue.rule !== "app.titleNotBlank")
    throw new Error(`The blank title was refused with ${JSON.stringify(blank.params.issues)}.`);

  console.log("e2e ok: create, list and the titleNotBlank rule");
} finally {
  server.process.kill();
  rmSync(notesFile, { force: true });
}
