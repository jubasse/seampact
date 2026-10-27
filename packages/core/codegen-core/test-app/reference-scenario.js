// The scenario every Node server target's test app shares, for the live boundary tests: the `tasks` api's handler
// objects (one class instance per generated interface), hooks and handler answers driven by what the test sets, and
// the record of what they saw. Plain JavaScript, as a loosely typed app would write its hooks; each target's test
// copies it next to its app.
import { gzipSync } from "node:zlib";

const ENCODING_WRITER = "encoding:";

export const ALLOWED_ORIGIN = "https://app.example";

/** A request carrying this header with a status is refused with it by app middleware before the router. */
export const FAIL_BEFORE_HEADER = "x-fail-before-router";

/** A request carrying this header gets its value as the reply's `Retry-After` from app middleware, as a throttler sets it. */
export const THROTTLE_RETRY_AFTER_HEADER = "x-throttle-retry-after";

const HANDLER_INTERFACES = {
  AppEndpoints: ["health"],
  ChannelsEndpoints: ["listChannels", "getChannel"],
  TasksEndpoints: [
    "listTasks",
    "createTask",
    "getTasksBatch",
    "searchTasks",
    "getTask",
    "updateTask",
    "archiveTask",
    "assignTask",
    "purgeTask",
  ],
  DraftsEndpoints: ["getDraft", "deleteDraft"],
  PreferencesEndpoints: ["getPreferences", "updatePreferences"],
  HooksEndpoints: ["payments"],
};

const USER_TOKEN_PREFIX = "user-";

/** What the hooks and handlers saw, read by the test. */
export const calls = { scopeIds: [], handled: [], unexpected: [], loggedErrors: [] };

/** How the hooks and handlers answer; the test replaces members and calls `resetScenario` between tests. */
export const scenario = {};

export function resetScenario() {
  scenario.answers = {};
  scenario.authenticate = authenticateByBearer;
  scenario.decide = () => ({ allow: true });
  scenario.resolvedScopeName = "channel";
  scenario.trustsProxy = false;
  calls.scopeIds.length = 0;
  calls.handled.length = 0;
  calls.unexpected.length = 0;
  calls.loggedErrors.length = 0;
}

/**
 * The app's trust-proxy setting, as the function form Express, Fastify and Adonis take: the test turns it on with
 * `scenario.trustsProxy`, so one booted app serves a request with and without a trusted proxy.
 */
export function trustsProxy() {
  return scenario.trustsProxy;
}

/** Thrown by a handler to make the app's error handler write a reply, with the framework's own send, Node's
 * `writeHead`, or a body in a content encoding (`encoding:gzip`). */
export class AppReply extends Error {
  constructor(status, contentType, body, writer = "send") {
    super(`app reply ${status}`);
    this.status = status;
    this.contentType = contentType;
    this.body = body;
    this.writer = writer;
  }

  /** The encoding of an `encoding:<name>` writer, undefined for the other writers. */
  get encoding() {
    return this.writer.startsWith(ENCODING_WRITER)
      ? this.writer.slice(ENCODING_WRITER.length)
      : undefined;
  }

  /** The body as sent: gzip-encoded for `encoding:gzip`, else as is. */
  get encodedBody() {
    return this.encoding === "gzip" ? gzipSync(this.body) : Buffer.from(this.body);
  }
}

function authenticateByBearer(request) {
  const token = request.credentials.bearer;

  if (typeof token === "string" && token.startsWith(USER_TOKEN_PREFIX)) {
    return { principal: { userId: token.slice(USER_TOKEN_PREFIX.length) } };
  }

  return { deny: { code: "api.unauthenticated" } };
}

function sampleTask(taskId) {
  return {
    taskId,
    title: "Write the slice",
    state: "open",
    effort: 3,
    version: 1,
    createdAt: "2026-10-19T08:00:00Z",
  };
}

const DEFAULT_ANSWERS = {
  health: () => ({ status: 200, body: { status: "ok" } }),
  getChannel: (input) => ({
    status: 200,
    body: { channelId: input.path.channelId, name: "General" },
  }),
  getTask: (input) => ({ status: 200, body: sampleTask(input.path.taskId) }),
  createTask: () => ({ status: 201, body: sampleTask(crypto.randomUUID()) }),
};

// A class instance per interface, so the test proves the router keeps `this`.
class ScenarioHandlers {
  constructor(operations) {
    for (const operation of operations) {
      this[operation] = function handle(input) {
        return this.answer(operation, input);
      };
    }
  }

  answer(operation, input) {
    calls.handled.push(operation);

    const handler = scenario.answers[operation] ?? DEFAULT_ANSWERS[operation];

    if (handler === undefined) throw new Error(`the test app has no answer for '${operation}'`);

    return handler(input);
  }
}

export const handlers = Object.fromEntries(
  Object.entries(HANDLER_INTERFACES).map(([name, operations]) => [
    name,
    new ScenarioHandlers(operations),
  ]),
);

function memoryIdempotencyStore() {
  const records = new Map();

  return {
    begin(claim) {
      const record = records.get(claim.key);

      if (record === undefined) {
        records.set(claim.key, { fingerprint: claim.fingerprint });

        return { outcome: "started" };
      }

      if (record.fingerprint !== claim.fingerprint) return { outcome: "mismatch" };

      return record.response === undefined
        ? { outcome: "running" }
        : { outcome: "replay", response: record.response };
    },
    complete(key, response) {
      const record = records.get(key);

      if (record !== undefined) record.response = response;
    },
    abandon(key) {
      records.delete(key);
    },
  };
}

export const hooks = {
  authenticate: {
    user: { authenticate: (request) => scenario.authenticate(request) },
    stripe: { authenticate: () => ({ principal: { account: "acct_1" } }) },
  },
  deciders: [{ names: "all", decider: { decide: (request) => scenario.decide(request) } }],
  scopeResolvers: {
    channel: {
      resolveScope(request) {
        calls.scopeIds.push(request.source.id);

        return { resolved: { scope: scenario.resolvedScopeName, id: request.source.id } };
      },
    },
  },
  idempotencyStore: memoryIdempotencyStore(),
  onUnexpectedError(exceptionOrReply, context) {
    calls.unexpected.push({ exceptionOrReply, context });
  },
};
