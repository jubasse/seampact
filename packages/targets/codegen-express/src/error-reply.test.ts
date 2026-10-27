import { pathToFileURL } from "node:url";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { target } from "./index.js";

// The shared status rule, exercised on the copy of the Node runtime that the Express target writes into a project.

interface ContractRoute {
  id: string;
}

interface StatusErrorReply {
  code: string;
  params?: unknown;
}

type StatusError = (
  route: ContractRoute,
  status: number,
  detail: undefined,
  fixes: Record<string, string>,
  facts?: Record<string, unknown>,
) => StatusErrorReply;

const PROJECT = projectDirectory(import.meta.url, "error-reply");
const COPIED_ERROR_REPLY = "generated/server/tasks/node-server/error-reply.ts";

let statusError: StatusError;

beforeAll(async () => {
  await generateReferenceProject(PROJECT, target, {});
  const copy = await import(pathToFileURL(`${PROJECT}/${COPIED_ERROR_REPLY}`).href);

  statusError = copy.statusError;
}, GENERATE_TIMEOUT_MILLISECONDS);

const FIXES = { requiredParams: "answer it from the handler", severalCodes: "pick one" };

// A route whose rateLimited code has an optional `retryAfterMs`, bound from the role's data.
function routeWithOptionalDelay(): ContractRoute {
  const route: unknown = {
    id: "createTask",
    errors: {
      "api.rate_limited": {
        code: "api.rate_limited",
        status: 429,
        nature: "rateLimited",
        roles: ["rateLimited"],
        roleParams: {
          rateLimited: {
            kind: "object",
            members: [
              { name: "retryAfterMs", value: { kind: "slot", slot: "retryAfterMs", path: [] } },
            ],
          },
        },
      },
    },
  };

  return route as ContractRoute;
}

describe("a 429 whose rateLimited code has an optional retryAfterMs", () => {
  test("fills the delay when the throttler gave one", () => {
    const error = statusError(routeWithOptionalDelay(), 429, undefined, FIXES, {
      retryAfterMs: 2000,
    });

    expect(error.code).toBe("api.rate_limited");
    expect(error.params).toEqual({ retryAfterMs: 2000 });
  });

  test("answers the bare code without a delay", () => {
    const error = statusError(routeWithOptionalDelay(), 429, undefined, FIXES);

    expect(error.code).toBe("api.rate_limited");
    expect(error.params).toBeUndefined();
  });
});
