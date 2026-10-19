// The parity probe: every route answers alike on both servers of a pair, and every boundary step the baseline
// must do shows in an answer, so a baseline that skips one differs. Needs no load tool, so a test can run it.
import type { BenchRequest, BenchRoute, ProbeRefusal, ProbeSequence } from "./route-types.mjs";

export interface ProbeArguments {
  readonly seampactUrl: string;
  readonly baselineUrl: string;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

const AUTHENTICATION_HEADERS = ["authorization", "stripe-signature"];
// The response headers the contract declares and both servers must send alike; the media type of the
// content-type stands for the whole header.
const COMPARED_HEADERS = ["link", "cache-control", "content-type"];
const CLIENT_ERROR_FIRST = 400;
const CLIENT_ERROR_LAST = 499;

async function ask(baseUrl: string, request: BenchRequest): Promise<Answer> {
  const response = await fetch(new URL(request.path, baseUrl), {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

function bothAnswers(options: ProbeArguments, request: BenchRequest): Promise<[Answer, Answer]> {
  return Promise.all([ask(options.seampactUrl, request), ask(options.baselineUrl, request)]);
}

function withoutVolatileMembers(body: unknown, route: BenchRoute): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;

  return Object.fromEntries(
    Object.entries(body).filter(([name]) => !route.volatileMembers.includes(name)),
  );
}

function stableBody(answer: Answer, route: BenchRoute): string {
  return JSON.stringify(withoutVolatileMembers(answer.body, route));
}

function withoutAuthentication(request: BenchRequest): BenchRequest {
  return {
    ...request,
    headers: Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !AUTHENTICATION_HEADERS.includes(name)),
    ),
  };
}

function isClientError(status: number): boolean {
  return status >= CLIENT_ERROR_FIRST && status <= CLIENT_ERROR_LAST;
}

function comparedHeader(answer: Answer, name: string): string | undefined {
  const value = answer.headers[name];

  return name === "content-type" ? value?.split(";")[0]?.trim() : value;
}

// Every route answers alike on both servers: the success (status, body, declared headers), the unknown-key
// refusal and the missing-credentials refusal, then the route's own refusals and idempotency sequences. Answers
// one line per difference; empty when the pair agrees.
export async function probe(
  options: ProbeArguments,
  routes: readonly BenchRoute[],
): Promise<{ readonly differences: readonly string[] }> {
  const differences: string[] = [];

  for (const route of routes) {
    differences.push(...(await successDifferences(route, options)));
    differences.push(
      ...(await refusalDifferences(
        route,
        { what: "unknown key", request: route.refusedRequest() },
        options,
      )),
    );

    const request = route.request(0);
    const anonymous = withoutAuthentication(request);

    if (Object.keys(anonymous.headers).length !== Object.keys(request.headers).length) {
      differences.push(
        ...(await refusalDifferences(
          route,
          { what: "no credentials", request: anonymous },
          options,
        )),
      );
    }

    for (const refusal of route.refusals ?? []) {
      differences.push(...(await refusalDifferences(route, refusal, options)));
    }

    for (const sequence of route.sequences ?? []) {
      differences.push(...(await sequenceDifferences(route, sequence, options)));
    }
  }

  return { differences };
}

async function successDifferences(route: BenchRoute, options: ProbeArguments): Promise<string[]> {
  const [seampact, baseline] = await bothAnswers(options, route.request(0));
  const differences: string[] = [];
  const seampactBody = stableBody(seampact, route);
  const baselineBody = stableBody(baseline, route);

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

  for (const name of COMPARED_HEADERS) {
    const seampactValue = comparedHeader(seampact, name);
    const baselineValue = comparedHeader(baseline, name);

    if (seampactValue !== baselineValue) {
      differences.push(
        `${route.id}: header ${name} is '${seampactValue}' on seampact and '${baselineValue}' on the baseline`,
      );
    }
  }

  return differences;
}

async function refusalDifferences(
  route: BenchRoute,
  refusal: ProbeRefusal,
  options: ProbeArguments,
): Promise<string[]> {
  const [seampact, baseline] = await bothAnswers(options, refusal.request);
  const agreed =
    refusal.status === undefined
      ? seampact.status === baseline.status && isClientError(seampact.status)
      : seampact.status === refusal.status && baseline.status === refusal.status;

  return agreed
    ? []
    : [
        `${route.id} (${refusal.what}): seampact answered ${seampact.status}, baseline ${baseline.status}; both must refuse with ${refusal.status ?? "the same 4xx"}`,
      ];
}

async function sequenceDifferences(
  route: BenchRoute,
  sequence: ProbeSequence,
  options: ProbeArguments,
): Promise<string[]> {
  const [seampact, baseline] = await Promise.all([
    sendInOrder(options.seampactUrl, sequence.requests),
    sendInOrder(options.baselineUrl, sequence.requests),
  ]);
  const differences: string[] = [];

  for (const [server, answers] of [
    ["seampact", seampact],
    ["baseline", baseline],
  ] as const) {
    const problem = sequenceProblem(sequence, answers);

    if (problem !== undefined)
      differences.push(`${route.id} (${sequence.what}): ${server} ${problem}`);
  }

  return differences;
}

async function sendInOrder(baseUrl: string, requests: readonly BenchRequest[]): Promise<Answer[]> {
  const answers: Answer[] = [];

  for (const request of requests) answers.push(await ask(baseUrl, request));

  return answers;
}

function sequenceProblem(sequence: ProbeSequence, answers: readonly Answer[]): string | undefined {
  const first = answers[0];
  const last = answers[answers.length - 1];

  if (first === undefined || last === undefined) return "answered nothing";

  if (typeof sequence.last === "object") {
    return last.status === sequence.last.status
      ? undefined
      : `answered ${last.status} to the last request, expected ${sequence.last.status}`;
  }

  return last.status === first.status && JSON.stringify(last.body) === JSON.stringify(first.body)
    ? undefined
    : `answered ${last.status} ${JSON.stringify(last.body)} to the repeated request, expected the first answer ${first.status} ${JSON.stringify(first.body)}`;
}
