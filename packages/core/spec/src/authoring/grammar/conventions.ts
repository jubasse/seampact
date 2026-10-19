// `conventions`: the api-wide settings (ADR 0002 section 13), and the error roles (section 11).

import {
  A2,
  A3,
  type JsonSchema,
  kw,
  list,
  map,
  object,
  oneOfValues,
  ref,
  str,
  stringOr,
} from "../dsl.js";
import { KEYS } from "./common.js";

const S = A2(13);

// ADR 0002 section 11: the roles derived errors answer.
export const ERROR_ROLES = [
  "unauthenticated",
  "csrfInvalid",
  "forbidden",
  "sortKeyForbidden",
  "notFound",
  "schemaInvalid",
  "payloadTooLarge",
  "unsupportedMediaType",
  "stateConflict",
  "idempotencyInProgress",
  "gone",
  "preconditionFailed",
  "idempotencyKeyReused",
  "preconditionRequired",
  "rateLimited",
  "undeclaredStatus",
  "upstreamUnavailable",
  "serviceUnavailable",
  "upstreamTimeout",
  "deadlineExceeded",
] as const;

export const ROLE_KEYS = ERROR_ROLES.join("|");

const OP_NAMES = ["list", "get", "create", "update", "delete", "batch"];

export function conventionsDefs(): Record<string, JsonSchema> {
  const positive = { type: "integer", minimum: 1 };

  return {
    conventions: object({
      description: "The api-wide settings, set by any layer, usually a pack (ADR 0002 section 13).",
      props: {
        format: kw(S, ref("common", "name"), "The wire format; bare by default."),
        pathCase: kw(S, oneOfValues("kebab", "camel", "snake")),
        paging: kw(
          S,
          object({
            props: {
              default: kw(S, ref("common", "name"), "The paging style of a list without paging."),
              maxLimit: kw(S, positive),
              defaultLimit: kw(S, positive),
              overLimit: kw(S, oneOfValues("reject", "clamp")),
            },
          }),
        ),
        idempotency: kw(
          S,
          object({
            props: {
              header: kw(S, ref("common", "headerName")),
              replayHeader: kw(S, ref("common", "headerName")),
              lifetime: kw(S, ref("common", "duration")),
              methods: kw(S, list(oneOfValues("post", "put", "patch", "delete"), { minItems: 1 })),
              required: kw(S, { type: "boolean" }),
              enforce: kw(S, oneOfValues("boundary", "none")),
            },
          }),
        ),
        bodyLimit: kw(S, ref("common", "size")),
        batch: kw(
          S,
          object({
            props: {
              maxIds: kw(S, positive),
              bodyLimit: kw(S, ref("common", "size")),
              budget: kw(S, ref("common", "duration")),
            },
          }),
        ),
        cache: kw(
          S,
          object({
            props: {
              families: kw(
                S,
                map({
                  keys: KEYS.name,
                  keyDescription: "a cache family name",
                  values: stringOr(
                    ref("common", "duration"),
                    ref("conventions", "cacheDirectives"),
                  ),
                }),
              ),
              sensitiveElsewhere: kw(S, oneOfValues("noStore", "refuse")),
            },
          }),
        ),
        restrictedInput: kw(S, oneOfValues("reject", "strip")),
        outputEnums: kw(S, oneOfValues("enum", "open")),
        pathVersion: kw(
          S,
          oneOfValues("prefix", "none"),
          "none: no surface path starts with /v{version}.",
        ),
        query: kw(
          S,
          object({
            props: {
              lists: kw(A2(7), oneOfValues("repeat", "comma", "brackets")),
              objects: kw(A2(7), oneOfValues("explode", "deepObject")),
              unknownKeys: kw(A2(7), ref("common", "unknownQueryPolicy")),
            },
          }),
        ),
        input: kw(
          S,
          object({ props: { unknownKeys: kw(A3(4), ref("common", "unknownKeysPolicy")) } }),
        ),
        int64: kw(S, oneOfValues("string", "number")),
        deprecation: kw(
          S,
          object({
            props: {
              header: kw(S, ref("common", "headerName")),
              sunsetHeader: kw(S, ref("common", "headerName")),
              // The IR's Deprecation.successorRel form: an RFC 8288 registered relation name.
              successorRel: kw(S, str({ pattern: "^[a-z][a-z0-9.-]*$" })),
            },
          }),
        ),
        ops: kw(
          A2(6),
          object({
            props: Object.fromEntries(
              OP_NAMES.map((op) => [
                op,
                kw(
                  A2(6),
                  object({
                    props: {
                      method: kw(A2(6), ref("common", "method")),
                      path: kw(A2(6), str()),
                      status: kw(A2(6), { type: "integer", minimum: 200, maximum: 299 }),
                    },
                  }),
                ),
              ]),
            ),
          }),
        ),
        operationIds: kw(
          A2(6),
          object({
            props: {
              order: kw(A2(6), oneOfValues("verbNoun", "nounVerb")),
              case: kw(A2(6), oneOfValues("camel", "snake")),
            },
          }),
        ),
        rateLimit: kw(
          S,
          object({
            props: {
              header: kw(S, ref("common", "headerName")),
              param: kw(S, str({ minLength: 1 })),
              unit: kw(S, oneOfValues("s", "ms")),
            },
          }),
        ),
        degradedHeader: kw(S, ref("common", "headerName")),
        urls: kw(S, oneOfValues("relative", "absolute")),
        rights: kw(
          A2(2),
          object({
            props: {
              pattern: kw(
                A2(2),
                str({ minLength: 1 }),
                "A pattern every right name must also match.",
              ),
            },
          }),
        ),
        errors: kw(
          A2(11),
          object({
            props: {
              pattern: kw(S, str({ minLength: 1 }), "A pattern every error code must also match."),
              every: kw(A2(11), ref("common", "errorCodes"), "Codes attached to every operation."),
              reach: kw(A2(11), oneOfValues("subtree", "resource")),
              derived: kw(
                A2(11),
                map({
                  keys: ROLE_KEYS,
                  keyDescription: "an error role",
                  keySection: A2(11),
                  values: ref("conventions", "roleBinding"),
                }),
                "Role bindings.",
              ),
            },
          }),
        ),
      },
    }),
    cacheDirectives: object({
      description: "Cache-Control directives in camel case (ADR 0002 section 13).",
      props: {
        maxAge: kw(S, ref("common", "duration")),
        sharedMaxAge: kw(S, ref("common", "duration")),
        staleWhileRevalidate: kw(S, ref("common", "duration")),
        staleIfError: kw(S, ref("common", "duration")),
        immutable: kw(S, { type: "boolean" }),
        noCache: kw(S, { type: "boolean" }),
        mustRevalidate: kw(S, { type: "boolean" }),
      },
    }),
    // ADR 0002 section 11: a code, or { code, params }.
    roleBinding: stringOr(
      ref("common", "errorCode"),
      object({
        props: {
          code: kw(A2(11), ref("common", "errorCode")),
          params: kw(A2(11), ref("common", "template"), "A template over the role's data."),
        },
        required: ["code"],
      }),
    ),
  };
}
