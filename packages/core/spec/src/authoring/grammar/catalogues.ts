// The catalogues of ADR 0002 section 1, one name-keyed file each, and `formats` (section 13).

import {
  A2,
  A3,
  type AuthoringFile,
  forbid,
  type JsonSchema,
  kw,
  list,
  map,
  object,
  oneOfValues,
  ref,
  req,
  str,
  when,
} from "../dsl.js";
import { KEYS } from "./common.js";
import { errorDeclarationProps } from "./node.js";

const schema = (): JsonSchema => ref("schema", "schema");
const fields = (): JsonSchema => ref("node", "fields");
const docs = (section: number): Record<string, JsonSchema> => ({
  summary: kw(A2(section), ref("common", "summary")),
  description: kw(A2(section), ref("common", "description")),
});
const lint = (): JsonSchema => kw(A2(12), ref("common", "lintAllow"));

export interface Catalogue {
  file: AuthoringFile;
  section: string;
  keys: string;
  keyDescription: string;
  // The definition of one entry, in the catalogue's own file (`entry`), or elsewhere.
  entry: JsonSchema;
  defs: Record<string, JsonSchema>;
  description: string;
}

const scheme = (kind: string, props: Record<string, JsonSchema>, rules: JsonSchema[] = []) =>
  object({
    props: { kind: kw(A2(9), oneOfValues(kind)), ...props, lint: lint() },
    rules,
  });

const pagingRole = (extra: Record<string, JsonSchema> = {}): JsonSchema =>
  object({
    props: {
      query: kw(A2(14), str({ minLength: 1 }), "The query parameter that carries the role."),
      header: kw(A2(14), ref("common", "headerName"), "The request header that carries the role."),
      ...extra,
    },
    rules: [
      {
        ...when(
          req("query"),
          forbid(["header"], "A role travels in a query parameter or a header, not both."),
        ),
      },
    ],
  });

const templates = (description: string): JsonSchema =>
  map({
    keys: null,
    keyDescription: "a member or header name",
    values: ref("common", "template"),
    description,
  });

export function catalogues(): Catalogue[] {
  return [
    {
      file: "schemas",
      section: A2(1),
      keys: KEYS.schemaName,
      keyDescription: "a schema name",
      entry: schema(),
      defs: {},
      description: "Named schemas, in the schema language of ADR 0003.",
    },
    {
      file: "enums",
      section: A2(12),
      keys: KEYS.schemaName,
      keyDescription: "an enum name",
      entry: ref("enums", "entry"),
      description: "Enums: values, source, reason, fallback (ADR 0002 section 12).",
      defs: {
        entry: object({
          props: {
            values: kw(A2(12), list({ type: "string" }, { minItems: 1 })),
            source: kw(A2(12), ref("enums", "source")),
            reason: kw(A2(12), str(), "Optional docs: why the enum is local."),
            fallback: kw(A2(12), str(), "The member a client maps an unknown value to."),
            codeNames: kw(
              A2(12),
              map({
                keys: null,
                keyDescription: "an enum value",
                values: str({ minLength: 1 }),
              }),
            ),
            ...docs(12),
          },
        }),
        source: object({
          props: {
            vocabulary: kw(A2(12), str({ minLength: 1 }), "An external vocabulary: a free label."),
            enum: kw(A2(12), ref("common", "schemaName"), "Takes another enum's values."),
          },
          rules: [
            {
              ...when(
                req("vocabulary"),
                forbid(["enum"], "A source is a vocabulary or an enum, not both."),
              ),
            },
          ],
        }),
      },
    },
    {
      file: "scalars",
      section: A3(8),
      keys: KEYS.scalarName,
      keyDescription: "a scalar (named format) name",
      entry: ref("scalars", "entry"),
      description: "Named formats: a base type plus portable refinements (ADR 0003 section 8).",
      defs: {
        entry: object({
          props: {
            type: kw(A3(8), oneOfValues("string", "integer")),
            pattern: kw(A3(9), str()),
            minLength: kw(A3(8), { type: "integer", minimum: 0 }),
            maxLength: kw(A3(8), { type: "integer", minimum: 0 }),
            minimum: kw(A3(8), { type: "number" }),
            maximum: kw(A3(8), { type: "number" }),
            exclusiveMinimum: kw(A3(8), { type: "number" }),
            exclusiveMaximum: kw(A3(8), { type: "number" }),
            multipleOf: kw(A3(8), { type: "number", exclusiveMinimum: 0 }),
            title: kw(A3(8), str()),
            description: kw(A3(8), ref("common", "description")),
          },
          required: ["type"],
        }),
      },
    },
    {
      file: "errors",
      section: A2(11),
      keys: KEYS.errorCode,
      keyDescription: "an error code",
      entry: ref("errors", "entry"),
      description: "Error codes, declared once (ADR 0002 section 11).",
      defs: {
        entry: object({ props: errorDeclarationProps(), required: ["status"] }),
      },
    },
    {
      file: "natures",
      section: A2(11),
      keys: KEYS.name,
      keyDescription: "a nature name",
      entry: ref("natures", "entry"),
      description: "Error natures, each mapped onto a base nature (ADR 0002 section 11).",
      defs: {
        entry: object({
          props: {
            base: kw(A2(11), oneOfValues("refused", "unavailable", "failed")),
            ...docs(11),
          },
          required: ["base"],
        }),
      },
    },
    {
      file: "schemes",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "a scheme name",
      entry: ref("schemes", "entry"),
      description: "Security schemes (ADR 0002 section 9).",
      defs: {
        entry: {
          title: "scheme",
          description:
            "kind: cookie, header, query, bearer, basic or signature (ADR 0002 section 9).",
          type: "object",
          ...when(
            { ...req("kind"), properties: { kind: { const: "signature" } } },
            ref("schemes", "signature"),
            {
              ...when(
                { ...req("kind"), properties: { kind: { const: "bearer" } } },
                ref("schemes", "bearer"),
                {
                  ...when(
                    { ...req("kind"), properties: { kind: { const: "cookie" } } },
                    ref("schemes", "cookie"),
                    {
                      ...when(
                        { ...req("kind"), properties: { kind: { enum: ["header", "query"] } } },
                        ref("schemes", "apiKey"),
                        {
                          ...when(
                            { ...req("kind"), properties: { kind: { const: "basic" } } },
                            ref("schemes", "basic"),
                            ref("schemes", "unknownKind"),
                          ),
                        },
                      ),
                    },
                  ),
                },
              ),
            },
          ),
        },
        cookie: scheme("cookie", {
          name: kw(A2(9), str({ minLength: 1 }), "The cookie name."),
          csrf: kw(
            A2(9),
            ref("common", "name"),
            "The header scheme a cookie write must also present.",
          ),
        }),
        apiKey: object({
          props: {
            kind: kw(A2(9), oneOfValues("header", "query")),
            name: kw(A2(9), str({ minLength: 1 }), "The header or query parameter name."),
            lint: lint(),
          },
        }),
        bearer: scheme(
          "bearer",
          {
            bearerFormat: kw(A2(9), str({ minLength: 1 }), "Documents the token's format."),
            oauth2: kw(
              A2(9),
              object({
                props: { flows: kw(A2(9), { type: "object" }, "An OpenAPI OAuth Flows Object.") },
                required: ["flows"],
              }),
            ),
            openIdConnect: kw(A2(9), str({ minLength: 1 }), "The OpenID Connect discovery URL."),
          },
          [
            {
              ...when(
                req("oauth2"),
                forbid(["openIdConnect"], "Write 'oauth2' or 'openIdConnect', never both."),
              ),
            },
          ],
        ),
        basic: scheme("basic", {}),
        // No known kind: a misspelt kind is the one problem reported, and so is a missing one.
        unknownKind: {
          title: "scheme kind",
          type: "object",
          properties: {
            kind: kw(
              A2(9),
              oneOfValues("cookie", "header", "query", "bearer", "basic", "signature"),
            ),
          },
          ...when(req("$include"), undefined, req("kind")),
        },
        signature: scheme(
          "signature",
          {
            name: kw(A2(9), ref("common", "headerName"), "The header carrying the signature."),
            verify: kw(A2(9), oneOfValues("template", "application"), "Who reads the signature."),
            format: kw(
              A2(9),
              str({ minLength: 1 }),
              "The layout of the signature header: holds {sig}.",
            ),
            algorithm: kw(A2(9), str({ minLength: 1 })),
            payload: kw(A2(9), str({ minLength: 1 }), "What is signed: holds {rawBody}."),
            encoding: kw(A2(9), str({ minLength: 1 })),
            tolerance: kw(A2(9), ref("common", "duration")),
            key: kw(A2(9), ref("schemes", "key")),
            headers: kw(
              A2(9),
              list(ref("common", "headerName")),
              "verify: application only: the headers the hook receives.",
            ),
          },
          [
            {
              ...when(
                { ...req("verify"), properties: { verify: { const: "application" } } },
                forbid(
                  ["format", "algorithm", "payload", "encoding", "tolerance"],
                  "verify: application parses nothing; the authenticate hook verifies.",
                ),
              ),
            },
          ],
        ),
        key: object({
          description:
            "{ value: <literal> } or { from: <path, query or header source> } (ADR 0002 section 9).",
          props: {
            value: kw(A2(9), str({ minLength: 1 })),
            from: kw(A2(9), ref("common", "signatureKeySource")),
          },
          rules: [
            { ...when(req("value"), forbid(["from"], "A key is a value or a source, not both.")) },
          ],
        }),
      },
    },
    {
      file: "headers",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "an identity header name",
      entry: ref("headers", "entry"),
      description: "Identity headers (ADR 0002 section 9).",
      defs: {
        entry: object({
          props: {
            name: kw(A2(9), ref("common", "headerName")),
            in: kw(A2(9), oneOfValues("request", "response")),
            semantic: kw(
              A2(9),
              oneOfValues("deadline", "traceContext", "actorSurface", "versionToken"),
            ),
            schema: kw(A2(9), schema()),
            response: kw(A2(9), ref("common", "headerName"), "versionToken: the response header."),
            request: kw(A2(9), ref("common", "headerName"), "versionToken: the request header."),
          },
          required: ["semantic"],
          rules: [
            {
              ...when(
                { ...req("semantic"), properties: { semantic: { const: "versionToken" } } },
                forbid(["name", "in"], "A versionToken declares 'response' and 'request' instead."),
                forbid(
                  ["response", "request"],
                  "Only a versionToken declares 'response' and 'request'.",
                ),
              ),
            },
          ],
        }),
      },
    },
    {
      file: "identities",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "an identity name",
      entry: ref("identities", "entry"),
      description: "Identities (ADR 0002 section 9).",
      defs: {
        entry: object({
          props: {
            kind: kw(A2(9), oneOfValues("credential", "signed")),
            schemes: kw(
              A2(9),
              object({
                props: {
                  read: kw(A2(9), ref("common", "names")),
                  write: kw(A2(9), ref("common", "names")),
                  optionalRead: kw(A2(9), ref("common", "names")),
                },
                required: ["read", "write"],
              }),
            ),
            scheme: kw(A2(9), ref("common", "name"), "signed only: the one signature scheme."),
            principal: kw(A2(9), ref("identities", "principal")),
            unknownKeys: kw(A2(9), ref("common", "unknownKeysException")),
            errors: kw(A2(9), ref("common", "errorCodes")),
            headers: kw(
              A2(9),
              map({
                keys: KEYS.name,
                keyDescription: "an identity header name",
                values: ref("identities", "headerUse"),
              }),
            ),
            lint: lint(),
            ...docs(12),
          },
          rules: [
            {
              ...when(
                { ...req("kind"), properties: { kind: { const: "signed" } } },
                forbid(["schemes"], "A signed identity names one 'scheme'."),
                forbid(
                  ["scheme", "unknownKeys"],
                  "'scheme' and 'unknownKeys' belong to a signed identity.",
                ),
              ),
            },
          ],
        }),
        principal: {
          description:
            "The principal schema, or { variants: { <name>: <schema> } } (ADR 0002 section 9).",
          ...when(
            { type: "object", ...req("variants") },
            object({
              props: {
                variants: kw(
                  A2(9),
                  map({
                    keys: KEYS.name,
                    keyDescription: "a variant name",
                    values: schema(),
                  }),
                ),
              },
            }),
            schema(),
          ),
        },
        headerUse: object({
          props: {
            for: kw(A2(9), oneOfValues("all", "reads", "writes")),
            required: kw(A2(9), { type: "boolean" }),
            schema: kw(A2(9), schema()),
            from: kw(A2(9), ref("common", "principalSource"), "versionToken: the principal field."),
            stale: kw(
              A2(9),
              ref("common", "errorCode"),
              "versionToken: the code of a stale request header.",
            ),
          },
        }),
      },
    },
    {
      file: "rights",
      section: A2(9),
      keys: KEYS.rightName,
      keyDescription: "a right name",
      entry: ref("rights", "entry"),
      description: "Rights (ADR 0002 section 9).",
      defs: {
        entry: object({
          extensions: true,
          props: {
            params: kw(A2(9), fields()),
            subject: kw(A2(9), ref("rights", "subject")),
            guest: kw(
              A2(9),
              ref("common", "reason"),
              "Lets an anonymous caller reach the right, with the reason.",
            ),
            errors: kw(A2(9), ref("common", "errorCodes")),
            codeName: kw(
              A2(9),
              str({ minLength: 1 }),
              "The identifier generated code uses for the right.",
            ),
            lint: lint(),
            ...docs(9),
          },
        }),
        subject: object({
          description:
            "{ scope: <scope> } or { resource: <Name>, id: <id schema> } (ADR 0002 section 9).",
          props: {
            scope: kw(A2(9), ref("common", "name")),
            resource: kw(A2(9), ref("common", "schemaName")),
            id: kw(A2(9), schema()),
          },
          rules: [
            {
              ...when(
                req("scope"),
                forbid(["resource", "id"], "A subject is a scope or a resource, not both."),
              ),
            },
          ],
        }),
      },
    },
    {
      file: "rules",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "a rule name",
      entry: ref("rules", "entry"),
      description: "Rules: pre-handler checks that are not rights (ADR 0002 section 9).",
      defs: {
        entry: object({
          extensions: true,
          props: {
            bucket: kw(A2(9), { type: "boolean" }, "Each use names a bucket."),
            params: kw(A2(9), fields()),
            errors: kw(A2(9), ref("common", "errorCodes")),
            proof: kw(
              A2(9),
              object({
                props: {
                  in: kw(A2(9), oneOfValues("body", "header")),
                  name: kw(A2(9), str({ minLength: 1 })),
                  schema: kw(A2(9), schema()),
                },
                required: ["in", "name"],
              }),
            ),
            lint: lint(),
            ...docs(9),
          },
        }),
      },
    },
    {
      file: "requirements",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "a requirement name",
      entry: ref("node", "requirement"),
      defs: {},
      description: "Named requirement items (ADR 0002 section 9).",
    },
    {
      file: "scopes",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "a scope name",
      entry: ref("scopes", "entry"),
      description: "Tenancy scopes (ADR 0002 section 9).",
      defs: {
        entry: object({
          extensions: true,
          props: {
            id: kw(A2(9), schema()),
            within: kw(A2(9), ref("common", "name"), "The parent scope."),
            errors: kw(A2(9), ref("common", "errorCodes")),
            lint: lint(),
            ...docs(9),
          },
        }),
      },
    },
    {
      file: "buckets",
      section: A2(9),
      keys: KEYS.name,
      keyDescription: "a bucket name",
      entry: ref("buckets", "entry"),
      description: "Rate-limit buckets (ADR 0002 section 9).",
      defs: {
        entry: object({
          props: {
            key: kw(A2(9), list(ref("common", "bucketKeySource"), { minItems: 1 })),
            limit: kw(A2(9), { type: "integer", minimum: 1 }),
            window: kw(A2(9), ref("common", "duration")),
          },
          required: ["key"],
        }),
      },
    },
    {
      file: "services",
      section: A2(10),
      keys: KEYS.name,
      keyDescription: "a service name",
      entry: ref("services", "entry"),
      description: "Upstream services (ADR 0002 section 10).",
      defs: {
        entry: object({ props: { maturity: kw(A2(10), ref("common", "maturityLevel")) } }),
      },
    },
    {
      file: "pagings",
      section: A2(14),
      keys: KEYS.name,
      keyDescription: "a paging style name",
      entry: ref("pagings", "entry"),
      description: "Paging styles (ADR 0002 section 14).",
      defs: {
        entry: object({
          props: {
            request: kw(
              A2(14),
              object({
                props: {
                  cursor: kw(A2(14), pagingRole()),
                  after: kw(A2(14), pagingRole()),
                  before: kw(A2(14), pagingRole()),
                  page: kw(A2(14), pagingRole({ base: kw(A2(14), { enum: [0, 1] }) })),
                  offset: kw(A2(14), pagingRole()),
                  since: kw(A2(14), pagingRole()),
                  limit: kw(A2(14), pagingRole()),
                  sort: kw(
                    A2(14),
                    pagingRole({
                      style: kw(A2(14), oneOfValues("signed", "pair", "keyed", "split")),
                      direction: kw(
                        A2(14),
                        str({ minLength: 1 }),
                        "style: split: the direction parameter.",
                      ),
                    }),
                  ),
                },
              }),
            ),
            response: kw(
              A2(14),
              object({
                props: {
                  meta: kw(A2(14), templates("Members added to the format's page.")),
                  body: kw(A2(14), ref("common", "template"), "The whole page body."),
                  headers: kw(A2(14), templates("Response headers.")),
                  links: kw(A2(14), templates("RFC 8288 relations, each a URL role.")),
                },
                rules: [
                  { ...when(req("body"), forbid(["meta"], "Write 'body' or 'meta', not both.")) },
                ],
              }),
            ),
            absent: kw(A2(14), oneOfValues("omit", null)),
          },
        }),
      },
    },
    {
      file: "formats",
      section: A2(13),
      keys: KEYS.name,
      keyDescription: "a wire format name",
      entry: ref("formats", "entry"),
      description: "Wire formats (ADR 0002 section 13).",
      defs: {
        entry: object({
          props: {
            media: kw(A2(13), str({ minLength: 1 })),
            absent: kw(A2(13), oneOfValues("omit", null)),
            success: kw(
              A2(13),
              object({
                props: {
                  item: kw(A2(13), ref("formats", "shape")),
                  table: kw(A2(13), ref("formats", "shape")),
                  list: kw(A2(13), ref("formats", "shape")),
                  page: kw(A2(13), ref("formats", "shape")),
                },
              }),
            ),
            meta: kw(
              A2(13),
              map({
                keys: null,
                keyDescription: "a meta field name",
                values: object({
                  props: {
                    fill: kw(A2(13), {
                      title: "meta fill",
                      description: "now, traceId, degraded, handler or principal.<field>.",
                      type: "string",
                      pattern:
                        "^(?:now|traceId|degraded|handler|principal\\.[^.\\s]+(?:\\.[^.\\s]+)*)$",
                    }),
                    schema: kw(A2(13), schema()),
                  },
                  required: ["fill"],
                }),
              }),
            ),
            error: kw(
              A2(13),
              object({
                props: {
                  media: kw(A2(13), str({ minLength: 1 })),
                  body: kw(A2(13), ref("common", "template")),
                  headers: kw(A2(13), templates("Response headers.")),
                },
              }),
            ),
          },
        }),
        shape: object({
          props: {
            body: kw(A2(13), ref("common", "template")),
            headers: kw(A2(13), templates("Response headers, each a template.")),
          },
        }),
      },
    },
  ];
}
