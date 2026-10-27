import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";
import type { RawReply } from "./live-request.test-support.js";

// The booted handler access tests of the Node server targets: what a handler reads of its caller beside its input,
// the principal and the resolved scopes, on a target's test app serving the shared reference scenario.

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "22222222-2222-4222-8222-222222222222";
const USER = "55555555-5555-4555-8555-555555555555";
const OTHER_USER = "66666666-6666-4666-8666-666666666666";
const CHANNEL_OPERATION = "getChannel";
// Long enough for the requests of two apis to be served at once.
const HANDLER_DELAY_MILLISECONDS = 20;

/** What the test app's handler answers receive, as the shared reference scenario calls them. */
export interface HandlerAccessApp {
  readonly scenario: { answers: Record<string, (input: unknown, ...rest: never[]) => unknown> };
}

/** A booted test app and a request to it. */
export interface HandlerAccessBoot {
  readonly app: HandlerAccessApp;
  send(method: string, path: string, headers: Record<string, string>): Promise<RawReply>;
}

/** What a handler read: its path, principal and scopes, and the input members a serialisation keeps. */
export interface ReadAccess {
  readonly path: unknown;
  readonly principal: unknown;
  readonly scopes: unknown;
  readonly serialisedMembers: readonly string[];
}

function bearerOf(user: string): Record<string, string> {
  return { authorization: `Bearer user-${user}` };
}

/** Records what the operation's handler reads, then answers as the scenario's default does. */
export function readAccessOf(
  app: HandlerAccessApp,
  operation: string,
  answer: (input: unknown) => unknown,
): ReadAccess[] {
  const reads: ReadAccess[] = [];

  app.scenario.answers[operation] = async (input) => {
    await delay(HANDLER_DELAY_MILLISECONDS);

    if (typeof input !== "object" || input === null)
      throw new Error("the handler received no input");

    reads.push({
      path: Reflect.get(input, "path"),
      principal: Reflect.get(input, "principal"),
      scopes: Reflect.get(input, "scopes"),
      serialisedMembers: Object.keys(JSON.parse(JSON.stringify(input))),
    });

    return answer(input);
  };

  return reads;
}

function channelAnswer(input: unknown): unknown {
  const path: unknown =
    typeof input === "object" && input !== null ? Reflect.get(input, "path") : undefined;
  const channelId: unknown =
    typeof path === "object" && path !== null ? Reflect.get(path, "channelId") : undefined;

  return { status: 200, body: { channelId, name: "General" } };
}

/** The handler access tests of one api: an identified caller, and a public route's anonymous one. */
export function describeHandlerAccess(booted: () => HandlerAccessBoot): void {
  test("a handler reads its caller's principal and scopes, which the wire input never carries", async () => {
    const { app, send } = booted();
    const reads = readAccessOf(app, CHANNEL_OPERATION, channelAnswer);
    const reply = await send("GET", `/v1/channels/${CHANNEL}`, bearerOf(USER));

    expect(reply.status).toBe(200);
    expect(reads).toEqual([
      {
        path: { channelId: CHANNEL },
        principal: { userId: USER },
        scopes: { channel: { scope: "channel", id: CHANNEL } },
        serialisedMembers: expect.not.arrayContaining(["principal", "scopes"]),
      },
    ]);
  });

  test("a public route's handler reads a null principal and no scope", async () => {
    const { app, send } = booted();
    const reads = readAccessOf(app, "health", () => ({ status: 200, body: { status: "ok" } }));
    const reply = await send("GET", "/v1/health", {});

    expect(reply.status).toBe(200);
    expect(reads).toMatchObject([{ principal: null, scopes: {} }]);
  });
}

/**
 * Two apis served at once on one app, `tasks` and the one beside it under `/v1/beside`: each handler reads the
 * caller of its own request.
 */
export function describeTwoApiHandlerAccess(booted: () => HandlerAccessBoot): void {
  test("the handlers of two apis served at once each read their own caller", async () => {
    const { app, send } = booted();
    const reads = readAccessOf(app, CHANNEL_OPERATION, channelAnswer);
    const replies = await Promise.all([
      send("GET", `/v1/channels/${CHANNEL}`, bearerOf(USER)),
      send("GET", `/v1/beside/channels/${OTHER_CHANNEL}`, bearerOf(OTHER_USER)),
    ]);

    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(reads).toHaveLength(2);
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: { channelId: CHANNEL },
          principal: { userId: USER },
          scopes: { channel: { scope: "channel", id: CHANNEL } },
        }),
        expect.objectContaining({
          path: { channelId: OTHER_CHANNEL },
          principal: { userId: OTHER_USER },
          scopes: { channel: { scope: "channel", id: OTHER_CHANNEL } },
        }),
      ]),
    );
  });
}
