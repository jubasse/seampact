import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { probe } from "./project/probe.mts";
import type { BenchRequest, BenchRoute } from "./project/route-types.mts";

// A small server standing for either side of a pair. Each flag is a boundary step the baseline may skip.
interface Steps {
  readonly decider: boolean;
  readonly idempotency: boolean;
  readonly signature: boolean;
  readonly linkHeader: boolean;
}

const ALL_STEPS: Steps = { decider: true, idempotency: true, signature: true, linkHeader: true };
const THROTTLED = "throttled";
const GOOD_SIGNATURE = "good";

const listRequest: BenchRequest = {
  method: "GET",
  path: "/list",
  headers: { authorization: "user" },
};

function write(token: string, body: object, idempotencyKey: string): BenchRequest {
  return {
    method: "POST",
    path: "/create",
    headers: { authorization: token, "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  };
}

const replayedKey = randomUUID();
const reusedKey = randomUUID();
const payment: BenchRequest = {
  method: "POST",
  path: "/pay",
  headers: { "stripe-signature": GOOD_SIGNATURE },
  body: "{}",
};

const routes: readonly BenchRoute[] = [
  {
    id: "list",
    title: "list",
    successStatus: 200,
    request: () => listRequest,
    refusedRequest: () => ({ ...listRequest, path: "/list?unknown=1" }),
    volatileMembers: [],
  },
  {
    id: "create",
    title: "create",
    successStatus: 201,
    request: () => write("user", { title: "a" }, randomUUID()),
    refusedRequest: () => write("user", { title: "a", unknown: true }, randomUUID()),
    volatileMembers: ["id"],
    refusals: [
      { what: "throttled", request: write(THROTTLED, { title: "a" }, randomUUID()), status: 429 },
    ],
    sequences: [
      {
        what: "replay",
        requests: [
          write("user", { title: "a" }, replayedKey),
          write("user", { title: "a" }, replayedKey),
        ],
        last: "replays the first",
      },
      {
        what: "key reused",
        requests: [
          write("user", { title: "a" }, reusedKey),
          write("user", { title: "b" }, reusedKey),
        ],
        last: { status: 422 },
      },
    ],
  },
  {
    id: "pay",
    title: "pay",
    successStatus: 204,
    request: () => payment,
    refusedRequest: () => ({ ...payment, body: '{"unknown":true}' }),
    volatileMembers: [],
    refusals: [
      {
        what: "bad signature",
        request: { ...payment, headers: { "stripe-signature": "bad" } },
      },
    ],
  },
];

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString();
}

function answer(
  response: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function serverWith(steps: Steps): Promise<Server> {
  const claims = new Map<string, { fingerprint: string; reply: object }>();
  const server = createServer(async (request, response) => {
    const text = await bodyOf(request);
    const {
      authorization,
      "stripe-signature": signature,
      "idempotency-key": key,
    } = request.headers;

    if (request.url?.includes("unknown") || text.includes("unknown")) return answer(response, 400);

    if (request.url === "/list") {
      if (authorization === undefined) return answer(response, 401);

      return answer(
        response,
        200,
        [{ id: 1 }],
        steps.linkHeader ? { link: '<x>; rel="next"' } : {},
      );
    }

    if (request.url === "/pay") {
      if (steps.signature && signature !== GOOD_SIGNATURE) return answer(response, 401);

      return answer(response, 204);
    }

    if (authorization === undefined) return answer(response, 401);

    if (steps.decider && authorization === THROTTLED) return answer(response, 429);

    const fresh = { id: randomUUID() };

    if (!steps.idempotency || typeof key !== "string") return answer(response, 201, fresh);

    const claim = claims.get(key);

    if (claim === undefined) {
      claims.set(key, { fingerprint: text, reply: fresh });

      return answer(response, 201, fresh);
    }

    return claim.fingerprint === text ? answer(response, 201, claim.reply) : answer(response, 422);
  });

  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const running: Server[] = [];

async function urlOf(steps: Steps): Promise<string> {
  const server = await serverWith(steps);

  running.push(server);

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function differencesWithout(skipped: keyof Steps | undefined) {
  const baseline = skipped === undefined ? ALL_STEPS : { ...ALL_STEPS, [skipped]: false };
  const verdict = await probe(
    { seampactUrl: await urlOf(ALL_STEPS), baselineUrl: await urlOf(baseline) },
    routes,
  );

  return verdict.differences.join("\n");
}

afterEach(() => {
  for (const server of running.splice(0)) server.close();
});

describe("the parity probe", () => {
  test("passes a baseline that does every step", async () => {
    expect(await differencesWithout(undefined)).toBe("");
  });

  test("fails a baseline without the decider call", async () => {
    expect(await differencesWithout("decider")).toContain("create (throttled)");
  });

  test("fails a baseline without the idempotency claim", async () => {
    const differences = await differencesWithout("idempotency");

    expect(differences).toContain("create (replay)");
    expect(differences).toContain("create (key reused)");
  });

  test("fails a baseline without the signature check", async () => {
    expect(await differencesWithout("signature")).toContain("pay (bad signature)");
  });

  test("fails a baseline answering another status than the contract declares", async () => {
    const wrongStatus = routes.map((route) =>
      route.id === "list" ? { ...route, successStatus: 202 } : route,
    );
    const verdict = await probe(
      { seampactUrl: await urlOf(ALL_STEPS), baselineUrl: await urlOf(ALL_STEPS) },
      wrongStatus,
    );

    expect(verdict.differences.join("\n")).toContain("the contract declares 202");
  });

  test("fails a baseline without a declared response header", async () => {
    expect(await differencesWithout("linkHeader")).toContain("header link");
  });
});
