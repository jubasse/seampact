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
  return JSON.stringify({ type: code, status, code, nature: "refused" });
}

/** The client address a trusted proxy forwards in `X-Forwarded-For`, from the documentation range of RFC 5737. */
export const FORWARDED_CLIENT_ADDRESS = "203.0.113.7";

/** The socket address of a test request: the loopback, in its IPv4, IPv6 or IPv4-mapped form. */
export const LOOPBACK_ADDRESS = /^(?:::ffff:)?127\.0\.0\.1$|^::1$/;

/** The address the hooks see behind a proxy the app trusts, and behind one it does not. */
export const CLIENT_ADDRESS_CASES = [
  { proxy: "a trusted proxy", trustsProxy: true, address: /^203\.0\.113\.7$/ },
  { proxy: "an untrusted proxy", trustsProxy: false, address: LOOPBACK_ADDRESS },
] as const;

/** The part of a test app's scenario that sets its trust-proxy setting and its authenticate hook. */
export interface ProxyScenario {
  trustsProxy: boolean;
  authenticate: (request: unknown) => unknown;
}

/**
 * Sends one request through a proxy that forwards `FORWARDED_CLIENT_ADDRESS`, with the app trusting it or not, and
 * answers the reply and the client addresses the authenticate hook saw in its request view.
 */
export async function clientAddressesTheHookSees(
  scenario: ProxyScenario,
  trustsProxy: boolean,
  sendForwarded: (forwardedHeader: Record<string, string>) => Promise<RawReply>,
): Promise<{ readonly reply: RawReply; readonly seen: readonly unknown[] }> {
  const seen: unknown[] = [];
  const authenticate = scenario.authenticate;

  scenario.trustsProxy = trustsProxy;
  scenario.authenticate = (request) => {
    seen.push(requestViewOf(request)?.clientAddress);

    return authenticate(request);
  };

  const reply = await sendForwarded({ "x-forwarded-for": FORWARDED_CLIENT_ADDRESS });

  return { reply, seen };
}

function requestViewOf(hookRequest: unknown): { readonly clientAddress?: unknown } | undefined {
  if (typeof hookRequest !== "object" || hookRequest === null) return undefined;

  const view: unknown = Reflect.get(hookRequest, "request");

  return typeof view === "object" && view !== null ? view : undefined;
}
