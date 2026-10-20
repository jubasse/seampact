import {
  answerPage,
  type BootedPages,
  bootPages,
  laravelOffsetChannels,
  PAGE_CHANNELS,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { target as expressTarget } from "./index.js";

// Boots the generated Laravel tasks api with its channel list on an offset style, and reads the page Express serves.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 120_000;

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
      next: "/v1/channels?limit=10&offset=15",
      previous: "/v1/channels?limit=10&offset=0",
    });
    expect(reply.headers.link).toBe(
      '</v1/channels?limit=10&offset=15>; rel="next", </v1/channels?limit=10&offset=0>; rel="prev"',
    );
  });
});
