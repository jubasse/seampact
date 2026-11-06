import {
  answerPage,
  type BootedPages,
  bootPages,
  CLAMPED_MAX_LIMIT,
  laravelClampedChannels,
  laravelOffsetChannels,
  PAGE_CHANNEL,
  PAGE_CHANNELS,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { target as expressTarget } from "./index.js";

// Boots the generated Laravel tasks api with its channel list on an offset style, and reads the page Express serves.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 120_000;
// The URL a client calls when a reverse proxy strips `/api` before the request reaches the app.
const PUBLIC_PAGE_URL = "https://public.example/api/v1/channels?offset=5&limit=10";
const NEXT_RELATION = /<([^>]*)>; rel="next"/;

describe("an offset page under Express", () => {
  let offsetPages: BootedPages;

  beforeAll(async () => {
    offsetPages = await bootPages(
      {
        testFileUrl: import.meta.url,
        name: "live-pages-offset",
        target: expressTarget,
        appSource: APP_SOURCE,
      },
      laravelOffsetChannels,
    );
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await offsetPages?.close();
  });

  test("an offset off a page start links the next page one limit further", async () => {
    answerPage(offsetPages, "listChannels", { total: 30 });

    const reply = await offsetPages.send("/v1/channels?offset=5&limit=10");

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      items: PAGE_CHANNELS,
      total: 30,
      offset: 5,
      from: 6,
      to: 7,
      next: "?limit=10&offset=15",
      previous: "?limit=10&offset=0",
    });
    expect(reply.headers.link).toBe(
      '<?limit=10&offset=15>; rel="next", <?limit=10&offset=0>; rel="prev"',
    );
  });

  test("behind a prefix-stripping proxy the next link resolves under the public prefix", async () => {
    answerPage(offsetPages, "listChannels", { total: 30 });

    const reply = await offsetPages.send("/v1/channels?offset=5&limit=10");
    const nextTarget = NEXT_RELATION.exec(String(reply.headers.link))?.[1];

    expect(nextTarget).toBeDefined();
    expect(new URL(nextTarget ?? "", PUBLIC_PAGE_URL).href).toBe(
      "https://public.example/api/v1/channels?limit=10&offset=15",
    );
  });
});

describe("a limit above the maximum under Express", () => {
  let clamped: BootedPages;

  beforeAll(async () => {
    clamped = await bootPages(
      {
        testFileUrl: import.meta.url,
        name: "live-pages-clamp",
        target: expressTarget,
        appSource: APP_SOURCE,
      },
      laravelClampedChannels,
    );
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await clamped?.close();
  });

  test("reaches the handler as the maximum under overLimit clamp, which the page reports", async () => {
    const receivedInputs: unknown[] = [];

    clamped.app.scenario.answers.listChannels = (input) => {
      receivedInputs.push(input);

      return { status: 200, body: { items: PAGE_CHANNELS, total: 30 } };
    };

    const reply = await clamped.send("/v1/channels?per_page=500");

    expect(reply.status).toBe(200);
    expect(receivedInputs).toEqual([
      expect.objectContaining({ query: expect.objectContaining({ per_page: CLAMPED_MAX_LIMIT }) }),
    ]);
    expect(JSON.parse(reply.text).meta).toMatchObject({
      per_page: CLAMPED_MAX_LIMIT,
      last_page: 3,
    });
  });

  test("is refused under the default overLimit", async () => {
    const reply = await clamped.send(`/v1/channels/${PAGE_CHANNEL}/tasks?per_page=500`);

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/per_page", rule: "maximum" }]);
  });
});
