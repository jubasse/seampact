import { createServer } from "node:http";
import { expect, test } from "vitest";
import { loadScript } from "./control-routes.js";
import type { SampleAppScript } from "./sample-app-script.js";

const NOT_FOUND = 404;

test("loadScript throws when the app answers the script PUT with something other than 204", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = NOT_FOUND;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (address === null || typeof address === "string") throw new Error("the server has no port");

  const script: SampleAppScript = {};

  try {
    await expect(
      loadScript(`http://127.0.0.1:${address.port}`, script, AbortSignal.timeout(10_000)),
    ).rejects.toThrow("answered 404, expected 204");
  } finally {
    server.close();
  }
});
