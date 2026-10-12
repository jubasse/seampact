// Surfaces and the tree (ADR 0002 sections 6 to 12): nodes, routes, `ops`, inherited settings,
// access and requirements (node.schema.json), and a node's `errors` map (node-errors.schema.json).

import {
  A2,
  conflict,
  forbid,
  type JsonSchema,
  keyNames,
  kw,
  list,
  map,
  object,
  oneOfValues,
  ref,
  req,
  str,
  stringOr,
  when,
} from "../dsl.js";
import { MARKERS } from "../markers.js";
import { KEYS } from "./common.js";
import { ROLE_KEYS } from "./conventions.js";

const schema = (): JsonSchema => ref("schema", "schema");
const fields = (): JsonSchema => ref("node", "fields");

// ADR 0002 section 8: the settings every node may set; descendants inherit them.
function inheritedSettings(options: { successor: boolean }): Record<string, JsonSchema> {
  return {
    identity: kw(A2(9), ref("common", "name"), "The identity the routes below require."),
    access: kw(A2(9), ref("node", "access")),
    requires: kw(A2(9), ref("node", "requires")),
    scopes: kw(
      A2(9),
      map({
        keys: KEYS.name,
        keyDescription: "a scope name",
        values: ref("common", "scopeSource"),
      }),
      "Scopes entered here, each read from a value source.",
    ),
    principal: kw(A2(9), ref("node", "principal")),
    bindings: kw(A2(9), ref("node", "bindings")),
    errors: kw(A2(11), ref("node-errors")),
    errorRoles: kw(
      A2(11),
      map({
        keys: ROLE_KEYS,
        keyDescription: "an error role",
        keySection: A2(11),
        values: ref("conventions", "roleBinding"),
      }),
      "Role bindings for this subtree, the nearest winning.",
    ),
    tags: kw(A2(10), list(str({ minLength: 1 }))),
    headers: kw(A2(7), fields(), "Request headers: a fields map keyed by header name."),
    query: kw(
      A2(7),
      fields(),
      "Query fields; on a node, they reach the safe routes below it only.",
    ),
    upstream: kw(
      A2(10),
      list(ref("common", "name"), { minItems: 1 }),
      "Services, the owner first.",
    ),
    maturity: kw(A2(10), ref("node", "maturity")),
    internal: kw(
      A2(10),
      { type: "boolean" },
      "Keeps the routes out of documents with internal: exclude.",
    ),
    deprecated: kw(A2(10), ref("node", options.successor ? "routeDeprecation" : "deprecation")),
    budget: kw(A2(10), ref("common", "duration")),
    bodyLimit: kw(A2(10), ref("common", "size")),
    cache: kw(A2(10), ref("node", "cache")),
    csrf: kw(A2(9), ref("node", "csrf")),
    idempotency: kw(A2(10), ref("node", "idempotency")),
    format: kw(A2(10), ref("common", "name"), "The wire format of the routes below."),
    unknownQuery: kw(A2(7), ref("common", "unknownQueryPolicy")),
    lint: kw(A2(12), ref("common", "lintAllow")),
  };
}

const docs = (section: number): Record<string, JsonSchema> => ({
  summary: kw(A2(section), ref("common", "summary")),
  description: kw(A2(section), ref("common", "description")),
});

const pathKeys = (): Record<string, JsonSchema> => ({
  path: kw(
    A2(6),
    str(),
    "Replaces the node's path segment: relative, no leading slash, may hold {param}.",
  ),
  pathParams: kw(A2(7), fields(), "The schemas of the extra path placeholders."),
});

// ADR 0002 section 7: the keys of a route.
function routeKeys(): Record<string, JsonSchema> {
  return {
    method: kw(A2(7), ref("common", "method")),
    ...pathKeys(),
    operationId: kw(A2(7), ref("common", "name"), "Replaces the derived operation id."),
    input: kw(A2(7), schema(), "The body schema."),
    inputMedia: kw(A2(7), oneOfValues("json", "form", "multipart")),
    output: kw(A2(7), schema(), "The body of the single success response."),
    item: kw(A2(10), schema(), "Instead of 'output', on a list: the schema of one record."),
    responses: kw(A2(7), ref("node", "responses")),
    paging: kw(A2(10), ref("node", "paging")),
    sortable: kw(A2(10), ref("node", "sortable")),
    filteredBy: kw(
      A2(10),
      ref("common", "rightName"),
      "The right the application applies to its query.",
    ),
    degradable: kw(A2(10), list(str({ minLength: 1 }), { minItems: 1 })),
    examples: kw(A2(12), ref("node", "examples")),
    ...docs(7),
  };
}

const NODE_SETTINGS_DOC = "settings, inherited below (ADR 0002 section 8)";

function opSettings(extra: Record<string, JsonSchema>): JsonSchema {
  return object({
    extensions: true,
    description: "The settings of one op: route keys and inherited settings (ADR 0002 section 6).",
    props: { ...routeKeys(), ...inheritedSettings({ successor: true }), ...extra },
  });
}

const OPS = {
  collection: ["list", "get", "create", "update", "delete", "batch"],
  single: ["get", "update", "delete"],
};

function ops(kind: "collection" | "single"): JsonSchema {
  const names = OPS[kind];
  const props = Object.fromEntries(
    names.map((op) => [op, kw(A2(6), ref("node", op === "batch" ? "batchOp" : "op"))]),
  );
  return {
    description: `The ops shorthand: a list of ${names.join(", ")}, or a mapping from op to its settings (ADR 0002 section 6).`,
    ...when({ type: "array" }, list({ enum: names }), object({ props })),
  };
}

const collectionScopeKeys = (): Record<string, JsonSchema> => ({
  item: kw(A2(6), schema(), "The schema of one record."),
  owner: kw(A2(6), oneOfValues("caller"), "caller: the caller owns the records."),
  concurrency: kw(A2(6), ref("node", "concurrency")),
  resourceType: kw(A2(6), str({ minLength: 1 }), "The value of the $collection slot."),
});

const routeProps = (): Record<string, JsonSchema> => ({
  ...routeKeys(),
  concurrency: kw(A2(6), { const: "inherit" }, "On a member route: opts into the version."),
  ...inheritedSettings({ successor: true }),
});

const collectionProps = (): Record<string, JsonSchema> => ({
  kind: kw(A2(6), oneOfValues("collection")),
  id: kw(A2(6), fields(), "A fields map with one entry: the member id parameter and its schema."),
  idProperty: kw(A2(6), str({ minLength: 1 }), "The item property holding the member id."),
  singular: kw(A2(6), ref("common", "name"), "The noun of member operation ids."),
  ...collectionScopeKeys(),
  ops: kw(A2(6), ops("collection")),
  collection: kw(A2(6), ref("node", "scope"), "The collection scope: settings plus routes."),
  member: kw(A2(6), ref("node", "scope"), "The member scope: settings plus routes."),
  ...pathKeys(),
  ...inheritedSettings({ successor: false }),
  ...docs(12),
});

const singleProps = (routes: JsonSchema): Record<string, JsonSchema> => ({
  kind: kw(A2(6), oneOfValues("single")),
  ...collectionScopeKeys(),
  ops: kw(A2(6), ops("single")),
  routes,
  ...pathKeys(),
  ...inheritedSettings({ successor: false }),
  ...docs(12),
});

export function nodeDefs(): Record<string, JsonSchema> {
  const routes = (node: string): JsonSchema =>
    kw(
      A2(6),
      map({
        title: MARKERS.routes,
        keys: KEYS.name,
        keyDescription: "a node name",
        values: ref("node", node),
        include: false,
      }),
      "The named children: a mapping from child name to node.",
    );
  return {
    // A surface root's child: a node or a relay route (ADR 0002 section 6).
    surfaceChild: {
      type: "object",
      ...when(req("relays"), ref("node", "relayRoute"), ref("node", "node")),
    },
    node: {
      title: "node",
      description:
        "A tree node: a route (method), a collection (kind: collection) or a single (kind: single) (ADR 0002 section 6).",
      type: "object",
      ...when(req("method"), ref("node", "route"), {
        ...when(
          { ...req("kind"), properties: { kind: { const: "collection" } } },
          ref("node", "collection"),
          {
            ...when(
              { ...req("kind"), properties: { kind: { const: "single" } } },
              ref("node", "single"),
              ref("node", "unmarked"),
            ),
          },
        ),
      }),
    },
    // A node without `method` and without a known `kind`: a misspelt kind is the one problem
    // reported, and so is a missing marker; with `$include`, the keys of any node are accepted.
    unmarked: {
      title: MARKERS.nodeMarker,
      type: "object",
      properties: {
        method: kw(A2(7), ref("common", "method")),
        kind: kw(A2(6), oneOfValues("collection", "single")),
      },
      ...when(req("$include"), ref("node", "includedNode"), {
        ...when(req("kind"), undefined, { ...req("method"), title: MARKERS.nodeMarker }),
      }),
    },
    route: object({
      extensions: true,
      description: `A route: ${NODE_SETTINGS_DOC}.`,
      props: routeProps(),
    }),
    // ADR 0002 section 7: a relay route writes only its operationId and the service's own settings.
    relayRoute: object({
      extensions: true,
      description:
        "A relay route: its shape is derived from the public operation (ADR 0002 section 7).",
      props: {
        relays: kw(
          A2(7),
          { type: "string", pattern: `^${KEYS.name}\\.${KEYS.name}$` },
          "<api>.<operationId>: the public operation this route relays.",
        ),
        operationId: kw(A2(7), ref("common", "name")),
        requires: kw(A2(9), ref("node", "requires")),
        errors: kw(A2(11), ref("node-errors")),
        errorRoles: kw(
          A2(11),
          map({
            keys: ROLE_KEYS,
            keyDescription: "an error role",
            keySection: A2(11),
            values: ref("conventions", "roleBinding"),
          }),
        ),
        budget: kw(A2(10), ref("common", "duration")),
        bodyLimit: kw(A2(10), ref("common", "size")),
        idempotency: kw(A2(10), ref("node", "idempotency")),
        upstream: kw(A2(10), list(ref("common", "name"), { minItems: 1 })),
        maturity: kw(A2(10), ref("node", "maturity")),
        deprecated: kw(A2(10), ref("node", "routeDeprecation")),
        tags: kw(A2(10), list(str({ minLength: 1 }))),
        ...docs(7),
      },
      required: ["relays"],
    }),
    collection: object({
      extensions: true,
      description: `A collection: ${NODE_SETTINGS_DOC}, ops, and the collection and member scopes.`,
      props: collectionProps(),
    }),
    single: object({
      extensions: true,
      description: `A single: ${NODE_SETTINGS_DOC}, ops and routes; with neither item nor ops, a group.`,
      props: singleProps(routes("node")),
    }),
    // A node fragment that brings its marker through `$include`: its keys are those of a route, a
    // collection or a single, each value checked once the include is resolved.
    includedNode: object({
      extensions: true,
      description: "A node whose kind comes from an included file (ADR 0002 section 2).",
      props: Object.fromEntries(
        Object.entries({
          ...routeProps(),
          ...collectionProps(),
          ...singleProps(routes("node")),
        }).map(([key, schema]) => [key, kw(String(schema.$comment), {})]),
      ),
    }),
    // The `collection` and `member` scopes of a collection.
    scope: object({
      extensions: true,
      props: {
        routes: routes("node"),
        ...inheritedSettings({ successor: false }),
        ...docs(12),
      },
    }),
    surface: object({
      extensions: true,
      description: "A surface: a named entry point with a path prefix (ADR 0002 section 6).",
      props: {
        prefix: kw(
          A2(6),
          str(),
          "The surface's leading path; {version} is replaced by api.version.",
        ),
        pathVersion: kw(
          A2(6),
          oneOfValues("prefix", "none"),
          "none: the prefix is used as written.",
        ),
        routes: routes("surfaceChild"),
        ...inheritedSettings({ successor: false }),
        ...docs(12),
      },
    }),
    op: opSettings({}),
    batchOp: opSettings({
      maxIds: kw(A2(6), { type: "integer", minimum: 1 }, "The most ids one batch read takes."),
    }),
    // ADR 0002 section 4: a fields map, or the name of a schema whose properties are the fields.
    fields: {
      description:
        "A fields map (a name ending with '?' is optional), or a schema name (ADR 0002 section 4).",
      ...stringOr(
        ref("schema", "reference"),
        map({ keys: null, keyDescription: "a field name", values: schema() }),
      ),
    },
    concurrency: object({
      props: {
        version: kw(
          A2(6),
          ref("common", "concurrencySource"),
          "Where the client sends the version.",
        ),
        field: kw(A2(6), str({ minLength: 1 }), "The item property it is compared with."),
      },
      required: ["version", "field"],
    }),
    // ADR 0002 section 9: access on a node.
    access: object({
      title: MARKERS.access,
      description:
        '{ public: "<reason>" } or { optionalAuth: "<reason>", onRefused } (ADR 0002 section 9).',
      props: {
        public: kw(A2(9), ref("common", "reason"), "No authentication, with the reason."),
        optionalAuth: kw(
          A2(9),
          ref("common", "reason"),
          "An anonymous caller or the identity, with the reason.",
        ),
        onRefused: kw(
          A2(9),
          oneOfValues("anonymous", "reject"),
          "A refused credential: anonymous or 401.",
        ),
      },
      rules: [
        {
          ...when(
            req("public"),
            forbid(
              ["optionalAuth", "onRefused"],
              "'public' excludes 'optionalAuth' and 'onRefused'.",
            ),
            {
              if: req("$include"),
              else: { ...req("optionalAuth"), title: MARKERS.access },
            },
          ),
        },
      ],
    }),
    csrf: object({
      title: MARKERS.csrfExemption,
      props: { exempt: kw(A2(9), ref("common", "reason"), "No CSRF check here, with the reason.") },
      required: ["exempt"],
    }),
    idempotency: object({
      title: MARKERS.idempotencyExemption,
      props: {
        exempt: kw(
          A2(10),
          ref("common", "reason"),
          "A write without the idempotency key, with the reason.",
        ),
      },
      required: ["exempt"],
    }),
    requires: list(stringOr(ref("common", "name"), ref("node", "requirement")), {
      description: "Requirements: a 'requirements' entry by name, or an item (ADR 0002 section 9).",
    }),
    // ADR 0002 section 9: one requirement item, a right or a rule.
    requirement: object({
      props: {
        right: kw(A2(9), ref("common", "rightName")),
        rule: kw(A2(9), ref("common", "name")),
        params: kw(A2(9), { type: "object" }, "The values of the right's or rule's typed params."),
        subject: kw(
          A2(9),
          ref("common", "subjectSource"),
          "Rights only: where the subject is read.",
        ),
        bucket: kw(A2(9), ref("common", "name"), "Rules declared with bucket: true only."),
      },
      rules: [
        {
          ...when(
            req("right"),
            {
              properties: {
                rule: conflict("A requirement names a right or a rule, not both."),
                bucket: conflict("'bucket' is for rules declared with bucket: true only."),
              },
            },
            {
              if: req("$include"),
              else: { ...req("rule"), ...forbid(["subject"], "'subject' is for rights only.") },
            },
          ),
        },
      ],
    }),
    principal: object({
      props: {
        requires: kw(
          A2(9),
          list(str({ minLength: 1 }), { minItems: 1 }),
          "Principal fields that must be present.",
        ),
      },
    }),
    bindings: map({
      description: "Maps a request value to a principal field (ADR 0002 section 9).",
      keys: "path\\.[^.\\s]+|query\\.[^.\\s]+|body\\.[^.\\s]+(?:\\.[^.\\s]+)*",
      keyDescription: "a binding key (path.<param>, query.<param> or body.<field>)",
      keySection: A2(9),
      values: ref("common", "bindingValue"),
    }),
    maturity: {
      description: "A level, or { level, reason } (ADR 0002 section 10).",
      ...stringOr(
        ref("common", "maturityLevel"),
        object({
          props: {
            level: kw(A2(10), ref("common", "maturityLevel")),
            reason: kw(A2(10), str(), "Optional docs: why the level is stated."),
          },
          required: ["level"],
        }),
      ),
    },
    deprecation: object({
      props: { sunset: kw(A2(10), ref("common", "date")) },
    }),
    routeDeprecation: object({
      props: {
        sunset: kw(A2(10), ref("common", "date")),
        successor: kw(A2(10), ref("common", "name"), "The operation id that replaces this route."),
      },
    }),
    cache: object({
      props: {
        freshness: kw(
          A2(10),
          ref("common", "name"),
          "A family of conventions.cache.families, or never.",
        ),
        anonymous: kw(A2(10), oneOfValues("public", "private")),
        vary: kw(A2(10), list(ref("common", "headerName"))),
        etag: kw(A2(10), { type: "boolean" }),
      },
    }),
    // ADR 0002 section 10: a style name, `none`, or { <style>: { maxLimit, ... } }.
    paging: {
      description:
        "A paging style name, none, or { <style>: { maxLimit, defaultLimit, overLimit, token } }.",
      ...stringOr(ref("common", "name"), {
        type: "object",
        properties: { $include: ref("common", "include") },
        propertyNames: keyNames(KEYS.name, "a paging style name", A2(10)),
        // One style; `$include` beside it is not one.
        ...when(req("$include"), { maxProperties: 2 }, { minProperties: 1, maxProperties: 1 }),
        additionalProperties: object({
          props: {
            maxLimit: kw(A2(10), { type: "integer", minimum: 1 }),
            defaultLimit: kw(A2(10), { type: "integer", minimum: 1 }),
            overLimit: kw(A2(10), oneOfValues("reject", "clamp")),
            token: kw(A2(10), oneOfValues("opaque", "instant")),
          },
        }),
      }),
    },
    sortable: list(
      stringOr(
        str({ minLength: 1 }),
        object({
          props: {
            key: kw(A2(10), str({ minLength: 1 })),
            right: kw(A2(10), ref("common", "rightName")),
          },
          required: ["key"],
        }),
      ),
      { description: "Sort keys: an item field, or { key, right } (ADR 0002 section 10)." },
    ),
    // ADR 0002 section 7: success and redirect responses keyed by status.
    responses: {
      ...map({
        description: "Success (200 to 299) and redirect (301, 302, 303, 307, 308) responses.",
        keys: "2[0-9][0-9]|30[1237]|308",
        keyDescription: "a success or redirect status",
        keySection: A2(7),
        values: object({
          props: {
            body: kw(A2(7), schema()),
            headers: kw(A2(7), fields(), "Response headers: a fields map keyed by name."),
            description: kw(A2(7), ref("common", "description")),
          },
        }),
      }),
      minProperties: 1,
    },
    // ADR 0002 section 12: named examples on a route.
    examples: map({
      keys: KEYS.name,
      keyDescription: "an example name",
      values: object({
        props: {
          status: kw(A2(12), { type: "integer", minimum: 200, maximum: 399 }),
          request: kw(A2(12), { const: true }),
          error: kw(A2(12), ref("common", "errorCode")),
          value: kw(A2(12), {}, "The payload, the request body or the code's params."),
        },
        required: ["value"],
      }),
    }),
  };
}

// ADR 0002 section 11: an error declaration's keys, shared by the catalogue and node attachments.
export function errorDeclarationProps(): Record<string, JsonSchema> {
  return {
    status: kw(A2(11), { type: "integer", minimum: 400, maximum: 599 }),
    nature: kw(A2(11), ref("common", "name"), "A base nature or one of the 'natures' catalogue."),
    family: kw(A2(11), ref("common", "errorCode"), "Groups codes in docs and clients."),
    params: kw(A2(11), fields(), "A fields map or a schema name."),
    example: kw(A2(11), {}, "The params."),
    title: kw(A2(11), str()),
    ...docs(12),
  };
}

export function nodeErrorsDefs(): Record<string, JsonSchema> {
  const reach = {
    reach: kw(
      A2(11),
      oneOfValues("subtree", "resource"),
      "How far below the node the code reaches.",
    ),
    for: kw(A2(11), oneOfValues("all", "reads", "writes")),
  };
  return {
    attachment: {
      description:
        "{} attaches a code, { example } narrows its example, a declaration (with status) declares it (ADR 0002 section 11).",
      type: "object",
      ...when(
        req("status"),
        object({ props: { ...errorDeclarationProps(), ...reach } }),
        object({ props: { example: kw(A2(11), {}), ...reach } }),
      ),
    },
  };
}
