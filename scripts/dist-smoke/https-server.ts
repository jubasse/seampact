import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeServer, LOOPBACK, type LoopbackServer, listenOnLoopback } from "./loopback.ts";

// A loopback HTTPS server for the release channel, with a throwaway certificate `openssl` makes at start. A
// client trusts it through `NODE_EXTRA_CA_CERTS=<caFile>`. It counts the requests of each path, so a test sees a
// cache hit.

const run = promisify(execFile);

const CERTIFICATE_DAYS = "1";

export interface ReleaseServer extends LoopbackServer {
  /** The certificate to trust. */
  readonly caFile: string;
  requestCount(path: string): number;
}

/** Serves each file at its path (`/name.tgz`). */
export async function startReleaseServer(
  work: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<ReleaseServer> {
  const keyFile = join(work, "release-key.pem");
  const caFile = join(work, "release-certificate.pem");

  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    caFile,
    "-days",
    CERTIFICATE_DAYS,
    "-subj",
    `/CN=${LOOPBACK}`,
    "-addext",
    `subjectAltName=IP:${LOOPBACK}`,
  ]);

  const counts = new Map<string, number>();
  const server = createServer(
    { key: readFileSync(keyFile), cert: readFileSync(caFile) },
    (request, response) => {
      const path = request.url ?? "";
      const body = files.get(path);

      counts.set(path, (counts.get(path) ?? 0) + 1);

      if (body === undefined) {
        response.writeHead(404).end();

        return;
      }

      response.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": body.length,
      });
      response.end(body);
    },
  );
  const port = await listenOnLoopback(server);

  return {
    url: `https://${LOOPBACK}:${port}`,
    caFile,
    requestCount: (path) => counts.get(path) ?? 0,
    close: () => closeServer(server),
  };
}
