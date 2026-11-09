// Starts `next start` on a free port and calls it with the generated client, as the React page does. Run `pnpm build` first.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createClient } from "../src/__generated__/client/notes";

const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

async function freePort(): Promise<number> {
  const probe = createServer();

  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));

  const address = probe.address();

  await new Promise((resolve) => probe.close(resolve));

  if (typeof address !== "object" || address === null)
    throw new Error("The probe does not listen on a TCP port.");

  return address.port;
}

async function waitUntilReady(baseUrl: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with ${server.exitCode}.`);

    try {
      await fetch(`${baseUrl}/v1/notes`);

      return;
    } catch {
      // Not listening yet: poll again until the deadline.
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error(`next start did not answer within ${READY_TIMEOUT_MS} ms.`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  stdio: "inherit",
});

try {
  await waitUntilReady(baseUrl, server);

  const client = createClient({ baseUrl });
  const created = await client.createNote({ body: { title: "First note" } });

  if (!created.ok) throw new Error(`createNote answered ${created.status}.`);

  const listed = await client.listNotes({ query: {} });

  if (!listed.ok || listed.body.items.length !== 1)
    throw new Error("listNotes did not return the created note.");

  // The app rule of src/input-rules.ts: a title of spaces passes the contract but not the rule.
  const blank = await fetch(`${baseUrl}/v1/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "   " }),
  });
  const refusal = JSON.stringify(await blank.json());

  if (blank.status !== 400 || !refusal.includes("/title") || !refusal.includes("app.titleNotBlank"))
    throw new Error(`A blank title was not refused with the rule: ${blank.status} ${refusal}`);

  console.log("e2e ok: create, list and the titleNotBlank rule");
} finally {
  // Stop our own server by its PID only.
  if (server.pid !== undefined && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));

    process.kill(server.pid);
    await exited;
  }
}
