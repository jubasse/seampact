// A server of the smoke harness on the loopback interface, at a port the system picks.

export const LOOPBACK = "127.0.0.1";

export interface LoopbackServer {
  readonly url: string;
  close(): Promise<void>;
}

interface ListeningServer {
  listen(port: number, host: string, listening: () => void): unknown;
  address(): unknown;
  close(callback: (error?: Error) => void): unknown;
}

/** Starts `server` on the loopback interface and returns its port. */
export async function listenOnLoopback(server: ListeningServer): Promise<number> {
  await new Promise<void>((listening) => server.listen(0, LOOPBACK, listening));

  const address = server.address();
  const port: unknown =
    typeof address === "object" && address !== null ? Reflect.get(address, "port") : undefined;

  if (typeof port !== "number") throw new Error("the loopback server listens on no port");

  return port;
}

export function closeServer(server: ListeningServer): Promise<void> {
  return new Promise((done, failed) => server.close((error) => (error ? failed(error) : done())));
}
