// What the front consumers' browser tests share: the tasks client on the page's origin, a fetch that records the
// requests it sends, the scripted list pages the server answers with, and a quiet wait before checking that nothing
// more was sent.
import { createClient } from "../../generated/client/tasks/index.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

/** How long a test waits to see that no further request goes out. */
export const QUIET_MS = 300;

export interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly idempotencyKey: string | null;
}

/** The tasks client calling the page's own origin with the user's token. */
export function clientFor(token: string, send: typeof fetch = fetch) {
  return createClient({
    baseUrl: window.location.origin,
    headers: { authorization: `Bearer ${token}` },
    fetch: send,
  });
}

/** A fetch that records each request it sends to the server. */
export function recordingFetch(): { readonly send: typeof fetch; readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const send: typeof fetch = (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      idempotencyKey: new Headers(init?.headers).get(IDEMPOTENCY_HEADER),
    });

    return fetch(input, init);
  };

  return { send, sent };
}

/** The list reads among the sent requests. */
export function listRequests(sent: readonly SentRequest[]): SentRequest[] {
  return sent.filter((request) => request.method === "GET" && request.url.includes("/tasks"));
}

/** A scripted `listTasks` answer: one task per title, and the next cursor when a page follows. */
export function scriptedPage(titles: readonly string[], nextCursor?: string) {
  return {
    status: 200,
    body: {
      items: titles.map((title, index) => ({
        taskId: `30000000-0000-4000-8000-00000000000${index}`,
        title,
        state: "open",
        version: 1,
        createdAt: "2026-10-18T09:00:00.000Z",
      })),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
