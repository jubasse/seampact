import { format } from "node:util";
import { expect, test, vi } from "vitest";
import type { HandlerAccessBoot } from "./live-handler-access.test-support.js";

// The booted debug test of the Node server targets: under `NODE_ENV=development` an exception the boundary does
// not map is answered by the framework's own error handler, and outside it by the api's 500, as before.

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TASK = "33333333-3333-4333-8333-333333333333";
// An operation the test apps leave under the default `responses: strict`.
const STRICT_OPERATION = "getTask";
const STRICT_PATH = `/v1/channels/${CHANNEL}/tasks/${TASK}`;
const BEARER = { authorization: "Bearer user-55555555-5555-4555-8555-555555555555" };
const THROWN_MESSAGE = "the debug test's unmapped failure";
const INTERNAL_ERROR = 500;
const DEBUG_NODE_ENV = "development";
const THIS_FILE = "live-debug-exceptions.test-support.ts";

function throwUnmapped(): never {
  throw new Error(THROWN_MESSAGE);
}

/** The debug test of one api: the same unmapped exception with and without `NODE_ENV=development`. */
export function describeDebugExceptions(booted: () => HandlerAccessBoot): void {
  test("an unmapped exception is the framework's under NODE_ENV=development, else the api's 500", async () => {
    const { app, send } = booted();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    app.scenario.answers[STRICT_OPERATION] = throwUnmapped;

    vi.stubEnv("NODE_ENV", "test");

    const contractReply = await send("GET", STRICT_PATH, BEARER);

    vi.stubEnv("NODE_ENV", DEBUG_NODE_ENV);

    const debugReply = await send("GET", STRICT_PATH, BEARER).finally(() => vi.unstubAllEnvs());
    const logged = consoleError.mock.calls.map((parts) => format(...parts));

    expect(contractReply.status).toBe(INTERNAL_ERROR);
    expect(contractReply.text).not.toContain(THROWN_MESSAGE);
    expect(debugReply.status).toBe(INTERNAL_ERROR);
    expect(debugReply.text).not.toBe(contractReply.text);
    expect(logged).toContainEqual(
      expect.stringMatching(
        new RegExp(`${THROWN_MESSAGE} at \\S*${THIS_FILE.replaceAll(".", "\\.")}:\\d+;`),
      ),
    );
  });
}
