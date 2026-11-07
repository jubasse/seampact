// The fix and the troubleshooting section of each form a Node target refuses as not generated yet, so that every
// refusal says what to change on its own. A fix that changes the api starts with "Ask the user first:"; a fix with a
// choice that keeps the api names that choice first.

const TROUBLESHOOTING_URL = "https://jubasse.github.io/seampact/troubleshooting/";

// The troubleshooting pages of the refusals `generate` prints.
export const GENERATE_TROUBLESHOOTING_URL = `${TROUBLESHOOTING_URL}generate/`;
export const LINK_TROUBLESHOOTING_URL = `${TROUBLESHOOTING_URL}link/`;

// The sections of the generate troubleshooting page that hold the Node targets' refusals, by heading anchor.
export const GENERATE_TROUBLESHOOTING_SECTIONS = {
  clients: "clients",
  nodeServers: "node-servers",
  everyNodeTarget: "every-node-target",
  everyServer: "every-server",
  openapiDocuments: "openapi-documents",
} as const;

export type GenerateTroubleshootingSection =
  (typeof GENERATE_TROUBLESHOOTING_SECTIONS)[keyof typeof GENERATE_TROUBLESHOOTING_SECTIONS];

export interface NotGeneratedFix {
  readonly fix: string;
  readonly section: GenerateTroubleshootingSection;
}

const { clients, nodeServers, everyNodeTarget, everyServer, openapiDocuments } =
  GENERATE_TROUBLESHOOTING_SECTIONS;

export const NOT_GENERATED_FIXES = {
  // Every Node target: the TypeScript types, the validators, the fetch client, the MSW mocks and the Node servers.
  "type.nullable": {
    section: everyNodeTarget,
    fix: "Ask the user first: make the value not nullable, or remove the operations that use it from `operations`.",
  },
  "type.file": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the operations that send or return a file from `operations`.",
  },
  "schema.union": {
    section: everyNodeTarget,
    fix: "Ask the user first: write the schema as an object, or remove the operations that use it from `operations`.",
  },
  "schema.map": {
    section: everyNodeTarget,
    fix: "Ask the user first: write the schema as an object with named members, or remove the operations that use it from `operations`.",
  },
  "schema.recursive": {
    section: everyNodeTarget,
    fix: "Ask the user first: break the cycle so the schema does not reach itself, or remove the operations that use it from `operations`.",
  },
  "property.codeName": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the property's `codeName`. The generated name then follows the wire name, which renames the code a Spring Boot, PHP or Python target generates from the same contract.",
  },
  "property.restrictedTo.required": {
    section: everyNodeTarget,
    fix: "Ask the user first: make the restricted property optional (end its name with `?`), or remove the operations that use it from `operations`.",
  },
  "enum.codeNames": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the enum's `codeNames`. The generated names then follow the values, which renames the code a Spring Boot, PHP or Python target generates from the same contract.",
  },
  "enum.fallback": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the enum's `fallback`, or the operations that use the enum from `operations`.",
  },
  "enum.narrowedTo": {
    section: everyNodeTarget,
    fix: "Ask the user first: use the whole enum instead of a narrowed one, or remove the operations that use it from `operations`.",
  },
  "unknownKeys.ignore": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the `unknownKeys` exception, so unknown keys are refused, or remove the operations that use it from `operations`.",
  },
  "unknownKeys.keep": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the `unknownKeys` exception, so unknown keys are refused, or remove the operations that use it from `operations`.",
  },
  "unknownQuery.ignore": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the `unknownQuery` exception, so unknown query keys are refused, or remove the operation from `operations`.",
  },
  "scalar.content": {
    section: everyNodeTarget,
    fix: "Ask the user first: declare the field as an object schema instead of JSON text, or remove the operations that use it from `operations`.",
  },
  "scalar.format": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the `format` of that value, or the operations that use it from `operations`.",
  },
  "scalar.named": {
    section: everyNodeTarget,
    fix: "Ask the user first: use a built-in type instead of that named format, or remove the operations that use it from `operations`.",
  },
  "scalar.bound.inexact": {
    section: everyNodeTarget,
    fix: "Ask the user first: use 0 or a bound of at least 0.000001 in magnitude (change the unit if needed), or remove the operations that use it from `operations`.",
  },
  "param.default": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the parameter's `default`, or the operation from `operations`.",
  },
  "input.media": {
    section: everyNodeTarget,
    fix: "Ask the user first: send the body as JSON, or remove the operation from `operations`.",
  },
  "input.proofs": {
    section: everyNodeTarget,
    fix: "Ask the user first: make the body an object schema, or remove the operation from `operations`.",
  },
  "response.media": {
    section: everyNodeTarget,
    fix: "Ask the user first: return a JSON body, or remove the operation from `operations`.",
  },
  "response.header": {
    section: everyNodeTarget,
    fix: "Ask the user first: remove the header from the route's response, or the operation from `operations`.",
  },
  "query.wire": {
    section: everyNodeTarget,
    fix: "Ask the user first: make the query parameter a scalar, an enum or a list of them in the `form` style, or remove the operation from `operations`.",
  },
  "wire.outputEnums.open": {
    section: everyNodeTarget,
    fix: "Ask the user first: set `conventions.outputEnums` to `enum`, or use another target.",
  },
  "wire.urls.absolute": {
    section: everyNodeTarget,
    fix: "Ask the user first: set `conventions.urls` to `relative`.",
  },

  // The fetch client and the MSW mocks.
  "path.param.type": {
    section: clients,
    fix: "Ask the user first: make the path parameter a scalar or an enum, or remove the operation from `operations`.",
  },
  "header.param.type": {
    section: clients,
    fix: "Ask the user first: make the header parameter a scalar or an enum, or remove the operation from `operations`.",
  },
  "query.style": {
    section: clients,
    fix: "Ask the user first: send the query value in the `form` style, or remove the operation from `operations`.",
  },
  "input.union.headerTag": {
    section: clients,
    fix: "Remove the operation from the client entry's `operations`: no Node target generates a union yet.",
  },
  "error.params.shape": {
    section: clients,
    fix: "Ask the user first: declare the error's params as an object, or remove the operations that answer the error from `operations`.",
  },
  deprecated: {
    section: clients,
    fix: "Ask the user first: remove the operation from `operations`, or drop its `deprecated`.",
  },
  "degradable.header": {
    section: clients,
    fix: "Ask the user first: remove the operation's `degradable`, or the operation from `operations`.",
  },
  "format.error.body": {
    section: clients,
    fix: "Ask the user first: use an error format whose body has a top-level `code` member and merged params.",
  },
  "format.error.media": {
    section: clients,
    fix: "Ask the user first: use an error format with a JSON body.",
  },
  "paging.response.headers.member": {
    section: clients,
    fix: "Ask the user first: write that paging header as its role alone, or remove the header from the paging style.",
  },
  "paging.response.headers.text": {
    section: clients,
    fix: "Ask the user first: write that paging header as its role alone, with no text around it, or remove the header from the paging style.",
  },
  "path.segment.literal": {
    section: clients,
    fix: "Ask the user first: remove the `*`, or the `:` and digits at its end, from that path segment, or remove the operation from the MSW entry's `operations`.",
  },
  "mock.page.fact": {
    section: clients,
    fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use a paging style whose page facts the handler result gives.",
  },
  "mock.envelope.member": {
    section: clients,
    fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use a format whose success body the mock fills.",
  },
  "mock.error.member": {
    section: clients,
    fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use an error format whose members are fixed names.",
  },

  // The Node servers: Express, Fastify, Hono, NestJS and AdonisJS.
  "access.optional": {
    section: nodeServers,
    fix: "Ask the user first: make the access required or public, or remove the operation from `operations`.",
  },
  "fieldRight.nestedPointer": {
    section: nodeServers,
    fix: "Ask the user first: move the right to a top-level field, or remove the operation from `operations`.",
  },
  "idempotency.enforce": {
    section: nodeServers,
    fix: "Ask the user first: keep `idempotency.enforce: boundary`, or remove the operation from `operations`.",
  },
  "paging.sortKey.restricted": {
    section: nodeServers,
    fix: "Ask the user first: leave the key out of `sortable`, or remove the operation from `operations`.",
  },
  "paging.sort.style": {
    section: nodeServers,
    fix: "Ask the user first: set the paging style's sort to `style: signed`, or remove the operations that use the style from `operations`.",
  },
  "paging.sort.in": {
    section: nodeServers,
    fix: "Ask the user first: read the sort from the query (`sort: { query: <name> }`), or remove the operation from `operations`.",
  },
  "paging.request.in": {
    section: nodeServers,
    fix: "Ask the user first: read that paging role from the query (`{ query: <name> }`), or remove the operation from `operations`.",
  },
  "paging.response.header": {
    section: nodeServers,
    fix: "Ask the user first: remove the header from the paging style's `response`, or the operation from `operations`.",
  },
  "paging.response.items": {
    section: nodeServers,
    fix: "Ask the user first: use a page body that writes `$items` under named members, or remove the operation from `operations`.",
  },
  "input.body.topLevel": {
    section: nodeServers,
    fix: "Ask the user first: make the request body a plain object schema, or remove the operation from `operations`.",
  },
  "path.segment.mixed": {
    section: nodeServers,
    fix: "Ask the user first: write each path segment as a whole parameter or as whole text, or remove the operation from `operations`.",
  },
  "output.file": {
    section: nodeServers,
    fix: "Ask the user first: remove the operations that return a file from `operations`.",
  },
  "output.opaque": {
    section: nodeServers,
    fix: "Ask the user first: declare the type of the opaque value, or remove the operations that return it from `operations`.",
  },
  "output.schema": {
    section: nodeServers,
    fix: "Ask the user first: make the output schema an object, or remove the operations that return it from `operations`.",
  },
  "format.several": {
    section: nodeServers,
    fix: "Ask the user first: use one format for every operation of the api, or split the api.",
  },
  "format.error.codeless": {
    section: nodeServers,
    fix: "Ask the user first: use an error format whose body writes `$code`.",
  },
  "format.error.headers": {
    section: nodeServers,
    fix: "Ask the user first: use an error format with no headers.",
  },
  "format.template": {
    section: nodeServers,
    fix: "Ask the user first: use a format made of slots, literals, `each` and objects with fixed member names.",
  },
  "format.memberName": {
    section: nodeServers,
    fix: "Ask the user first: use a format whose member names are fixed text.",
  },
  "principal.variants": {
    section: nodeServers,
    fix: "Ask the user first: use one principal schema, or remove the operation from `operations`.",
  },
  "scope.source": {
    section: nodeServers,
    fix: "Ask the user first: read the scope id from the path, or remove the operation from `operations`.",
  },
  "signature.application": {
    section: nodeServers,
    fix: "Ask the user first: use a signature template with a key value, or remove the operation from `operations`.",
  },
  "signature.key.source": {
    section: nodeServers,
    fix: "Ask the user first: use a signature template with a key value, or remove the operation from `operations`.",
  },
  "rule.proof.placement": {
    section: nodeServers,
    fix: "Ask the user first: send the rule proof in the body, or remove the operation from `operations`.",
  },
  valueSource: {
    section: nodeServers,
    fix: "Ask the user first: read the value from the path, a scope, the principal or a holder field, or remove the operation from `operations`.",
  },
  principalRequires: {
    section: nodeServers,
    fix: "Ask the user first: remove the operation's `principal: { requires: [...] }`, or the operation from `operations`.",
  },
  bindings: {
    section: nodeServers,
    fix: "Ask the user first: remove the operation's principal bindings, or the operation from `operations`.",
  },
  upstream: {
    section: nodeServers,
    fix: "Ask the user first: remove the operation's `upstream`, or the operation from `operations`.",
  },
  features: {
    section: nodeServers,
    fix: "Compile the contract with the seampact release this target reads: a newer compiler wrote this IR.",
  },
  extensions: {
    section: nodeServers,
    fix: "Ask the user first: remove the operation's extension values, or the operation from `operations`.",
  },
  "wire.name.vinePath": {
    section: nodeServers,
    fix: "Ask the user first: rename the member to letters, digits and `_`, or remove the operations that use it from `operations`.",
  },
  "wire.name.yupPath": {
    section: everyNodeTarget,
    fix: 'Use another validator target, such as Zod, or ask the user first to rename the member without `[`, `]` or `"`.',
  },
  "dto.listOfLists": {
    section: nodeServers,
    fix: "Ask the user first: wrap the inner list in an object schema, or remove the operations that use it from `operations`.",
  },
  "dto.memberName": {
    section: nodeServers,
    fix: "Ask the user first: rename the member in the contract, or remove the operations that use it from `operations`.",
  },

  // Forms several servers share, Node and native.
  "format.meta": {
    section: everyServer,
    fix: "Ask the user first: use a format with no meta member.",
  },
  "format.success.envelope": {
    section: everyServer,
    fix: "Ask the user first: use a format whose envelope puts `$payload` under named members.",
  },
  "format.success.slot": {
    section: everyServer,
    fix: "Ask the user first: use a format whose envelope writes only `$payload`.",
  },
  "format.success.headers": {
    section: everyServer,
    fix: "Ask the user first: use a format with no success header.",
  },
  "paging.response.slot": {
    section: everyServer,
    fix: "Ask the user first: use a paging style whose page writes only its response roles, or remove the operation from `operations`.",
  },
  "scheme.query": {
    section: everyServer,
    fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
  },
  "scheme.basic": {
    section: everyServer,
    fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
  },
  "scheme.signature": {
    section: everyServer,
    fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
  },
  degradable: {
    section: everyServer,
    fix: "Ask the user first: remove the operation's `degradable`, or the operation from `operations`.",
  },
  "concurrency.etag.withoutWrite": {
    section: everyServer,
    fix: "Ask the user first: serve the read and its writes in one api, or remove the read from `operations`.",
  },
  "deprecated.successor.otherApi": {
    section: everyServer,
    fix: "Ask the user first: name a successor in the same api, or drop the successor.",
  },
  "identity.response.header": {
    section: everyServer,
    fix: "Ask the user first: remove the operations under that identity from `operations`. For a header other than a `versionToken`, you may instead declare it `in: request`.",
  },
  "right.extensions": {
    section: everyServer,
    fix: "Ask the user first: remove the right's `extensions`, or the operations that use it from `operations`.",
  },
  "rule.extensions": {
    section: everyServer,
    fix: "Ask the user first: remove the rule's `extensions`, or the operations that use it from `operations`.",
  },
  "scope.extensions": {
    section: everyServer,
    fix: "Ask the user first: remove the scope's `extensions`, or the operations that use it from `operations`.",
  },
  "property.default": {
    section: everyServer,
    fix: "Ask the user first: remove the `default`, or the operations that use the schema from `operations`.",
  },
  "query.list.brackets": {
    section: everyServer,
    fix: "Ask the user first: set `conventions.query.lists` to `repeat` or `comma`.",
  },
  "response.shape": {
    section: everyServer,
    fix: "Ask the user first: remove the download or redirect operation from `operations`.",
  },
  "path.segment.encoded": {
    section: everyServer,
    fix: "Ask the user first: use plain ASCII letters, digits and `-` in that path segment.",
  },

  // The OpenAPI document.
  "openapi.scheme.bearer": {
    section: openapiDocuments,
    fix: "Ask the user first: keep either the OAuth 2 flows or the OpenID Connect URL on the bearer scheme.",
  },
  "openapi.format.error.headers": {
    section: openapiDocuments,
    fix: "Ask the user first: use an error format with no headers.",
  },
  "openapi.error.formats": {
    section: openapiDocuments,
    fix: "Ask the user first: answer the error in one format.",
  },
  "openapi.paging.headers": {
    section: openapiDocuments,
    fix: "Ask the user first: remove the headers from the paging style's `response`.",
  },
  "openapi.sensitive.shape": {
    section: openapiDocuments,
    fix: "Ask the user first: mark only scalar values as sensitive.",
  },
  "openapi.response.shape": {
    section: openapiDocuments,
    fix: "Ask the user first: remove the download or redirect operation from the document's operations.",
  },
  "openapi.example.request": {
    section: openapiDocuments,
    fix: "Remove the request example: it changes only the document.",
  },
  "openapi.input.brackets": {
    section: openapiDocuments,
    fix: "Ask the user first: name the form field without `[` and `]`, or remove the operation from the document's operations.",
  },
  "openapi.format.success.headers": {
    section: openapiDocuments,
    fix: "Ask the user first: use a format with no success header.",
  },
  "openapi.template.array": {
    section: openapiDocuments,
    fix: "Ask the user first: write the list with `$each` instead of an `array` template, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
  },
  "openapi.template.each": {
    section: openapiDocuments,
    fix: "Ask the user first: make `$each` read a list slot and write its `$as`, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
  },
  "openapi.template.slot-path": {
    section: openapiDocuments,
    fix: "Ask the user first: write the whole slot (`$x`) instead of one of its members (`$x.y`), or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
  },
  "openapi.template.slot": {
    section: openapiDocuments,
    fix: "Ask the user first: use a slot the format defines in that place, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
  },
  "openapi.template.member-name": {
    section: openapiDocuments,
    fix: "Ask the user first: give the member a fixed name instead of a slot, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
  },
  "openapi.template.member-repeated": {
    section: openapiDocuments,
    fix: "Ask the user first: write each member once in the format's object.",
  },
  "openapi.example.slot": {
    section: openapiDocuments,
    fix: "Remove the example: it changes only the document.",
  },
  "openapi.example.template": {
    section: openapiDocuments,
    fix: "Remove the example: it changes only the document.",
  },
  "openapi.example.merge": {
    section: openapiDocuments,
    fix: "Remove the example: it changes only the document.",
  },
  "openapi.example.member-name": {
    section: openapiDocuments,
    fix: "Remove the example: it changes only the document.",
  },
  "openapi.example.error": {
    section: openapiDocuments,
    fix: "Remove the error example: it changes only the document.",
  },
  "openapi.example.status": {
    section: openapiDocuments,
    fix: "Remove the example, or give it a status the operation answers: it changes only the document.",
  },
  "openapi.example.shape": {
    section: openapiDocuments,
    fix: "Remove the example: it changes only the document.",
  },
  "openapi.example.empty": {
    section: openapiDocuments,
    fix: "Remove the example of the response without a body: it changes only the document.",
  },
} as const satisfies Record<string, NotGeneratedFix>;

export type NotGeneratedForm = keyof typeof NOT_GENERATED_FIXES;

/** The URL of the troubleshooting section that holds the form's row. */
export function troubleshootingUrl(section: GenerateTroubleshootingSection): string {
  return `${GENERATE_TROUBLESHOOTING_URL}#${section}`;
}
