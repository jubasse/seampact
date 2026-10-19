// The load side of a run, in the bench project where autocannon is installed; prints one JSON document.
// usage: node --import tsx bench/load-driver.mts probe '{"seampactUrl":...,"baselineUrl":...}'
//        node --import tsx bench/load-driver.mts load '{"baseUrl":...,"routeId":...,"durationSeconds":...}'
import autocannon from "autocannon";
import { ALL_ROUTES, type BenchRequest, type BenchRoute, routeById } from "./routes.mjs";

interface ProbeArguments {
  readonly seampactUrl: string;
  readonly baselineUrl: string;
}

interface LoadArguments {
  readonly baseUrl: string;
  readonly routeId: string;
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly connections: number;
  /** Requests per second across connections; absent for a saturation run. */
  readonly overallRate?: number;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const PIPELINING = 1;
const AUTHENTICATION_HEADERS = ["authorization", "stripe-signature"];

const [command, rawArguments] = process.argv.slice(2);

if (rawArguments === undefined)
  throw new Error("bench: load-driver takes a command and its JSON arguments.");

const parsedArguments: unknown = JSON.parse(rawArguments);

if (command === "probe")
  console.log(JSON.stringify(await probe(parsedArguments as ProbeArguments)));
else if (command === "load")
  console.log(JSON.stringify(await load(parsedArguments as LoadArguments)));
else throw new Error(`bench: load-driver takes 'probe' or 'load', not '${command}'.`);

async function ask(baseUrl: string, request: BenchRequest): Promise<Answer> {
  const response = await fetch(new URL(request.path, baseUrl), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const text = await response.text();

  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

function withoutVolatileMembers(body: unknown, route: BenchRoute): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;

  return Object.fromEntries(
    Object.entries(body).filter(([name]) => !route.volatileMembers.includes(name)),
  );
}

function withoutAuthentication(request: BenchRequest): BenchRequest {
  return {
    ...request,
    headers: Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !AUTHENTICATION_HEADERS.includes(name)),
    ),
  };
}

// Every route answers alike on both servers: the success (status and body), the unknown-key refusal and the
// missing-credentials refusal (status). Answers one line per difference; empty when the pair agrees.
async function probe(
  options: ProbeArguments,
): Promise<{ readonly differences: readonly string[] }> {
  const differences: string[] = [];

  for (const route of ALL_ROUTES) {
    const request = route.request(0);
    const [seampact, baseline] = await Promise.all([
      ask(options.seampactUrl, request),
      ask(options.baselineUrl, request),
    ]);
    const seampactBody = JSON.stringify(withoutVolatileMembers(seampact.body, route));
    const baselineBody = JSON.stringify(withoutVolatileMembers(baseline.body, route));

    if (seampact.status < 200 || seampact.status > 299) {
      differences.push(
        `${route.id}: the seampact server answered ${seampact.status} to the valid request: ${seampactBody}`,
      );
    }

    if (seampact.status !== baseline.status || seampactBody !== baselineBody) {
      differences.push(
        `${route.id}: seampact ${seampact.status} ${seampactBody} against baseline ${baseline.status} ${baselineBody}`,
      );
    }

    differences.push(
      ...(await refusalDifferences(route, "unknown key", route.refusedRequest(), options)),
    );

    const anonymous = withoutAuthentication(request);

    if (Object.keys(anonymous.headers).length !== Object.keys(request.headers).length) {
      differences.push(...(await refusalDifferences(route, "no credentials", anonymous, options)));
    }
  }

  return { differences };
}

async function refusalDifferences(
  route: BenchRoute,
  what: string,
  request: BenchRequest,
  options: ProbeArguments,
): Promise<string[]> {
  const [seampact, baseline] = await Promise.all([
    ask(options.seampactUrl, request),
    ask(options.baselineUrl, request),
  ]);

  return seampact.status === baseline.status && seampact.status >= 400 && seampact.status < 500
    ? []
    : [
        `${route.id} (${what}): seampact answered ${seampact.status}, baseline ${baseline.status}; both must refuse alike`,
      ];
}

async function load(options: LoadArguments): Promise<unknown> {
  const route = routeById(options.routeId);
  let serial = 0;
  const run = (durationSeconds: number, overallRate: number | undefined) =>
    autocannon({
      url: options.baseUrl,
      connections: options.connections,
      pipelining: PIPELINING,
      duration: durationSeconds,
      ...(overallRate === undefined ? {} : { overallRate }),
      requests: [
        {
          setupRequest: (request: BenchRequest) => Object.assign(request, route.request(serial++)),
        },
      ],
    });

  if (options.warmupSeconds > 0) await run(options.warmupSeconds, undefined);

  const result = await run(options.durationSeconds, options.overallRate);

  return {
    requestsPerSecond: result.requests.average,
    latencyP50Ms: result.latency.p50,
    latencyP99Ms: result.latency.p99,
    requestsTotal: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
  };
}
