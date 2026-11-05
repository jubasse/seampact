// The local stand-in for the Central Portal of the rehearsal, which needs no account: it serves the publisher API
// calls publish-central makes (upload, status, publish, published) on the loopback, publishes a deployment by
// unzipping it into a file repository, and serves that repository as repo1 does, so the consumers of the rehearsal
// resolve the published artefacts from it. A deployment is `PENDING` at its first status call, then `VALIDATED`, so
// the poll is exercised. It checks only the authorization's form: it holds nothing secret.
//   node scripts/release/jvm/local-portal.ts <repository-dir> --url-file <file>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
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

interface Deployment {
  readonly directory: string;
  state: "PENDING" | "VALIDATED" | "PUBLISHED";
}

export interface LocalPortal {
  /** The base URL of the API; the repository is served at `<url>/maven2`. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

export async function startLocalPortal(repository: string): Promise<LocalPortal> {
  const deployments = new Map<string, Deployment>();
  const server = createServer((request, response) => {
    answer(request, response, repository, deployments).catch((error: unknown) =>
      reply(response, HTTP_BAD_REQUEST, error instanceof Error ? error.message : String(error)),
    );
  });

  await new Promise<void>((started) => server.listen(0, LOOPBACK, started));

  const address = server.address();

  if (address === null || typeof address === "string")
    throw new ReleaseError("the local portal has no TCP address");

  return { url: `http://${LOOPBACK}:${address.port}`, close: () => closed(server) };
}

function closed(server: Server): Promise<void> {
  return new Promise((done) => server.close(() => done()));
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  repository: string,
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
      directory: unzippedBundle(await multipartFile(request)),
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

function unzippedBundle(zip: Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-local-portal-"));

  writeFileSync(join(directory, "bundle.zip"), zip);
  execFileSync("unzip", ["-q", "bundle.zip", "-d", "files"], { cwd: directory });

  return join(directory, "files");
}

if (import.meta.main)
  await runReleaseCommand("local-portal", async () => {
    const usage = "local-portal.ts <repository-dir> --url-file <file>";
    const { values, positionals } = parsedArguments({ "url-file": { type: "string" } }, usage);
    const [repository] = positionals;
    const urlFile = values["url-file"];

    if (repository === undefined || urlFile === undefined)
      throw new ReleaseError(`usage: ${usage}`);

    const portal = await startLocalPortal(resolve(repository));

    writeFileSync(urlFile, `${portal.url}\n`);
    console.log(
      `local-portal: the publisher API on ${portal.url}, the repository ${resolve(repository)} on ${portal.url}/maven2`,
    );
  });
