import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

// Test support of the Node server targets' live boundary tests: one raw request to a booted test app.

const REPLY_TIMEOUT_MILLISECONDS = 3000;

/** Where a booted test app listens. */
export interface ListeningApp {
  readonly host: string;
  readonly port: number;
}

/** A reply as the test reads it. */
export interface RawReply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

/** A raw request: the path goes out byte for byte, without WHATWG URL normalization; a body is sent as JSON. */
export function sendRawRequest(
  server: ListeningApp,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: server.host,
        port: server.port,
        method,
        path,
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers,
        },
        timeout: REPLY_TIMEOUT_MILLISECONDS,
      },
      (incoming) => {
        const chunks: Buffer[] = [];

        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );

    outgoing.on("timeout", () => {
      outgoing.destroy();
      reject(new Error(`${method} ${path} got no reply within ${REPLY_TIMEOUT_MILLISECONDS} ms`));
    });
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

/** The body of a refusal in the reference api's problem format. */
export function problemBody(code: string, status: number): string {
  return JSON.stringify({ type: code, title: code, status, code, nature: "refused" });
}
