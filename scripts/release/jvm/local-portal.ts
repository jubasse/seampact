// The local stand-in for the Central Portal of the rehearsal, which needs no account: it serves the publisher API
// calls publish-central makes (upload, status, publish, published) on the loopback, publishes a deployment by
// unzipping it into a file repository, and serves that repository as repo1 does, so the consumers of the rehearsal
// resolve the published artefacts from it. A deployment is `PENDING` at its first status call, then `VALIDATED`, so
// the poll is exercised. It checks only the authorization's form: it holds nothing secret. Its uploads are unzipped
// in a working folder under `--work-dir`, else `RUNNER_TEMP`, removed when it stops.
//   node scripts/release/jvm/local-portal.ts <repository-dir> --url-file <file> [--work-dir <dir>]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError } from "../release-version.ts";
import { PUBLISHER_PATHS } from "./central-portal.ts";

const LOOPBACK = "127.0.0.1";
const REPOSITORY_PREFIX = "/maven2/";
const AUTHORIZATION = /^Bearer [A-Za-z0-9+/]+=*$/;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const MULTIPART_BOUNDARY = /boundary=(?:"([^"]+)"|([^;]+))/;
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;
const EXIT_STOPPED = 0;

interface Deployment {
  readonly directory: string;
  state: "PENDING" | "VALIDATED" | "PUBLISHED";
}

export interface LocalPortal {
  /** The base URL of the API; the repository is served at `<url>/maven2`. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

/**
 * Starts the portal on the loopback; its working folder is made under `workParent`, else `RUNNER_TEMP`, and
 * removed by `close`.
 */
export async function startLocalPortal(
  repository: string,
  workParent: string | undefined = process.env.RUNNER_TEMP,
): Promise<LocalPortal> {
  if (workParent === undefined || workParent === "")
    throw new ReleaseError(
      "the local portal has no parent for its working folder: pass --work-dir <dir> or set RUNNER_TEMP",
    );

  const work = mkdtempSync(join(workParent, "seampact-local-portal-"));
  const deployments = new Map<string, Deployment>();
  const server = createServer((request, response) => {
    answer(request, response, repository, work, deployments).catch((error: unknown) =>
      reply(response, HTTP_BAD_REQUEST, error instanceof Error ? error.message : String(error)),
    );
  });

  try {
    await new Promise<void>((started, failed) => {
      server.once("error", failed);
      server.listen(0, LOOPBACK, started);
    });

    const address = server.address();

    if (address === null || typeof address === "string")
      throw new ReleaseError("the local portal has no TCP address");

    return { url: `http://${LOOPBACK}:${address.port}`, close: () => closed(server, work) };
  } catch (error) {
    await closed(server, work);

    throw error;
  }
}

async function closed(server: Server, work: string): Promise<void> {
  if (server.listening) await new Promise<void>((done) => server.close(() => done()));

  rmSync(work, { recursive: true, force: true });
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  repository: string,
  work: string,
  deployments: Map<string, Deployment>,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${LOOPBACK}`);

  if (request.method === "GET" && url.pathname.startsWith(REPOSITORY_PREFIX)) {
    const file = join(
      repository,
      ...url.pathname
        .slice(REPOSITORY_PREFIX.length)
        .split("/")
        .filter((part) => part !== ".."),
    );

    if (!existsSync(file)) return reply(response, HTTP_NOT_FOUND, "not found");

    response.writeHead(HTTP_OK).end(readFileSync(file));

    return;
  }

  if (!AUTHORIZATION.test(request.headers.authorization ?? ""))
    return reply(response, HTTP_UNAUTHORIZED, "no bearer token");

  if (request.method === "GET" && url.pathname === PUBLISHER_PATHS.published) {
    const group = (url.searchParams.get("namespace") ?? "").split(".");
    const published = existsSync(
      join(
        repository,
        ...group,
        url.searchParams.get("name") ?? "",
        url.searchParams.get("version") ?? "",
      ),
    );

    return reply(response, HTTP_OK, JSON.stringify({ published }));
  }

  if (request.method === "POST" && url.pathname === PUBLISHER_PATHS.upload) {
    if (url.searchParams.get("publishingType") !== "USER_MANAGED")
      return reply(response, HTTP_BAD_REQUEST, "the rehearsal expects publishingType USER_MANAGED");

    const id = `local-${deployments.size + 1}`;

    deployments.set(id, {
      directory: unzippedBundle(await multipartFile(request), join(work, id)),
      state: "PENDING",
    });

    return reply(response, HTTP_CREATED, id);
  }

  const deployment = deployments.get(
    url.searchParams.get("id") ?? url.pathname.split("/").at(-1) ?? "",
  );

  if (deployment === undefined) return reply(response, HTTP_NOT_FOUND, "no such deployment");

  if (request.method === "POST" && url.pathname === PUBLISHER_PATHS.status) {
    const deploymentState = deployment.state;

    if (deployment.state === "PENDING") deployment.state = "VALIDATED";

    return reply(response, HTTP_OK, JSON.stringify({ deploymentState }));
  }

  if (request.method === "POST" && url.pathname.startsWith(PUBLISHER_PATHS.deployment)) {
    if (deployment.state !== "VALIDATED")
      return reply(response, HTTP_BAD_REQUEST, `the deployment is ${deployment.state}`);

    mkdirSync(repository, { recursive: true });
    execFileSync("cp", ["-R", `${deployment.directory}/.`, repository]);
    deployment.state = "PUBLISHED";

    return reply(response, HTTP_NO_CONTENT, "");
  }

  reply(response, HTTP_NOT_FOUND, `no route ${request.method} ${url.pathname}`);
}

function reply(response: ServerResponse, status: number, body: string): void {
  response
    .writeHead(status, { "content-type": "text/plain" })
    .end(status === HTTP_NO_CONTENT ? undefined : body);
}

// The one file part of a multipart body.
async function multipartFile(request: IncomingMessage): Promise<Buffer> {
  const boundaryMatch = MULTIPART_BOUNDARY.exec(request.headers["content-type"] ?? "");
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];

  if (boundary === undefined) throw new ReleaseError("the upload is not multipart/form-data");

  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  const body = Buffer.concat(chunks);
  const start = body.indexOf("\r\n\r\n") + 4;
  const end = body.indexOf(`\r\n--${boundary}--`);

  if (start < 4 || end < start) throw new ReleaseError("the upload holds no file part");

  return body.subarray(start, end);
}

// A deployment that fails to unzip leaves no folder behind.
function unzippedBundle(zip: Buffer, directory: string): string {
  mkdirSync(directory);

  try {
    writeFileSync(join(directory, "bundle.zip"), zip);
    execFileSync("unzip", ["-q", "bundle.zip", "-d", "files"], { cwd: directory });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });

    throw error;
  }

  rmSync(join(directory, "bundle.zip"));

  return join(directory, "files");
}

if (import.meta.main)
  await runReleaseCommand("local-portal", async () => {
    const usage = "local-portal.ts <repository-dir> --url-file <file> [--work-dir <dir>]";
    const { values, positionals } = parsedArguments(
      { "url-file": { type: "string" }, "work-dir": { type: "string" } },
      usage,
    );
    const [repository] = positionals;
    const urlFile = values["url-file"];

    if (repository === undefined || urlFile === undefined)
      throw new ReleaseError(`usage: ${usage}`);

    const portal = await startLocalPortal(
      resolve(repository),
      values["work-dir"] ?? process.env.RUNNER_TEMP,
    );

    // A stopped portal, the job's end or a cancel, removes its working folder.
    for (const signal of STOP_SIGNALS)
      process.once(signal, () => {
        portal.close().finally(() => process.exit(EXIT_STOPPED));
      });

    writeFileSync(urlFile, `${portal.url}\n`);
    console.log(
      `local-portal: the publisher API on ${portal.url}, the repository ${resolve(repository)} on ${portal.url}/maven2`,
    );
  });
