// The measured routes of the reference contract and the request each one sends, shared by the parity probe and the
// load driver so both servers of a pair see the same requests.
import { randomUUID } from "node:crypto";
import {
  bearer,
  STRIPE_SECRET,
  stripeSignature,
  THROTTLED_USER_TOKEN,
  USER_TOKEN,
} from "../test/credentials.mjs";
import type { BenchRequest, BenchRoute, ProbeSequence } from "./route-types.mjs";

const CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const TASK_ID = "20000000-0000-4000-8000-000000000001";
const JSON_HEADERS = { "content-type": "application/json" };
const USER_HEADERS = { authorization: bearer(USER_TOKEN) };
const CHANNEL_PATH = `/v1/channels/${CHANNEL_ID}`;
const TASKS_PATH = `${CHANNEL_PATH}/tasks`;
const PAYMENT_EVENT = { id: "evt_bench", type: "invoice.paid", data: {} };
const UNKNOWN_QUERY = "?unknown=1";
const KEY_REUSED_STATUS = 422;
const THROTTLED_STATUS = 429;
const BAD_SIGNATURE = "t=1,v1=00";

function userWrite(
  method: string,
  path: string,
  body: object,
  options: { readonly token?: string; readonly idempotencyKey?: string } = {},
): BenchRequest {
  return {
    method,
    path,
    headers: {
      authorization: bearer(options.token ?? USER_TOKEN),
      ...JSON_HEADERS,
      "idempotency-key": options.idempotencyKey ?? randomUUID(),
    },
    body: JSON.stringify(body),
  };
}

// The same key twice with the same body must replay the first answer; with another body it must be refused as a reused key.
function idempotencySequences(
  method: string,
  path: string,
  body: object,
  changedBody: object,
): readonly ProbeSequence[] {
  const send = (idempotencyKey: string, sent: object) =>
    userWrite(method, path, sent, { idempotencyKey });
  const replayedKey = randomUUID();
  const reusedKey = randomUUID();

  return [
    {
      what: "replay",
      requests: [send(replayedKey, body), send(replayedKey, body)],
      last: "replays the first",
    },
    {
      what: "key reused",
      requests: [send(reusedKey, body), send(reusedKey, changedBody)],
      last: { status: KEY_REUSED_STATUS },
    },
  ];
}

// The scheme checks a timestamp tolerance and never refuses a replay, so one signature serves a whole run.
const signedPayment: BenchRequest = {
  method: "POST",
  path: "/v1/hooks/payments",
  headers: { ...JSON_HEADERS, "stripe-signature": stripeSignature(PAYMENT_EVENT, STRIPE_SECRET) },
  body: JSON.stringify(PAYMENT_EVENT),
};

export const HEALTH_ROUTE: BenchRoute = {
  id: "health",
  title: "GET /v1/health (framework floor)",
  request: () => ({ method: "GET", path: "/v1/health", headers: {} }),
  refusedRequest: () => ({ method: "GET", path: `/v1/health${UNKNOWN_QUERY}`, headers: {} }),
  volatileMembers: [],
};

export const COMPARED_ROUTES: readonly BenchRoute[] = [
  {
    id: "getChannel",
    title: "simple GET channel",
    request: () => ({ method: "GET", path: CHANNEL_PATH, headers: USER_HEADERS }),
    refusedRequest: () => ({
      method: "GET",
      path: `${CHANNEL_PATH}${UNKNOWN_QUERY}`,
      headers: USER_HEADERS,
    }),
    volatileMembers: [],
  },
  {
    id: "updateTask",
    title: "validated JSON write",
    request: () =>
      userWrite("PATCH", `${TASKS_PATH}/${TASK_ID}`, { title: "Done", expectedVersion: 1 }),
    refusedRequest: () =>
      userWrite("PATCH", `${TASKS_PATH}/${TASK_ID}`, {
        title: "Done",
        expectedVersion: 1,
        unknown: true,
      }),
    volatileMembers: [],
    sequences: idempotencySequences(
      "PATCH",
      `${TASKS_PATH}/${TASK_ID}`,
      { title: "Done", expectedVersion: 1 },
      { title: "Other", expectedVersion: 1 },
    ),
  },
  {
    id: "listTasks",
    title: "paged list",
    request: () => ({
      method: "GET",
      path: `${TASKS_PATH}?limit=20&sort=-createdAt`,
      headers: USER_HEADERS,
    }),
    refusedRequest: () => ({
      method: "GET",
      path: `${TASKS_PATH}${UNKNOWN_QUERY}`,
      headers: USER_HEADERS,
    }),
    volatileMembers: [],
  },
  {
    id: "payments",
    title: "signed webhook",
    request: () => signedPayment,
    refusedRequest: () => ({
      ...signedPayment,
      body: JSON.stringify({ ...PAYMENT_EVENT, unknown: true }),
      headers: {
        ...JSON_HEADERS,
        "stripe-signature": stripeSignature({ ...PAYMENT_EVENT, unknown: true }, STRIPE_SECRET),
      },
    }),
    volatileMembers: [],
    refusals: [
      {
        what: "bad signature",
        request: {
          ...signedPayment,
          headers: { ...JSON_HEADERS, "stripe-signature": BAD_SIGNATURE },
        },
      },
      {
        what: "signature of another body",
        request: {
          ...signedPayment,
          headers: {
            ...JSON_HEADERS,
            "stripe-signature": stripeSignature(
              { ...PAYMENT_EVENT, id: "evt_other" },
              STRIPE_SECRET,
            ),
          },
        },
      },
    ],
  },
  {
    id: "createTask",
    title: "idempotent write",
    request: () => userWrite("POST", TASKS_PATH, { title: "Write the bench" }),
    refusedRequest: () =>
      userWrite("POST", TASKS_PATH, { title: "Write the bench", unknown: true }),
    volatileMembers: ["taskId"],
    refusals: [
      {
        what: "throttled user",
        request: userWrite(
          "POST",
          TASKS_PATH,
          { title: "Write the bench" },
          { token: THROTTLED_USER_TOKEN },
        ),
        status: THROTTLED_STATUS,
      },
    ],
    sequences: idempotencySequences(
      "POST",
      TASKS_PATH,
      { title: "Write the bench" },
      { title: "Another title" },
    ),
  },
];

export const ALL_ROUTES: readonly BenchRoute[] = [HEALTH_ROUTE, ...COMPARED_ROUTES];

export function routeById(id: string): BenchRoute {
  const route = ALL_ROUTES.find((candidate) => candidate.id === id);

  if (route === undefined) {
    throw new Error(`bench: no route '${id}'; routes: ${ALL_ROUTES.map((r) => r.id).join(", ")}.`);
  }

  return route;
}
