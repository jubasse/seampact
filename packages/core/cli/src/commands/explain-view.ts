import type { ContractIR, Operation, SourceMap } from "@seampact/spec/ir";
import { isRecord } from "../is-record.js";

// The text `seampact explain` prints (ADR 0002 section 16): one operation of the IR as YAML in the grammar's words,
// each line commented with the derivation that produced it and the file and line of the declaration that caused
// it, read through the side table. A view, never an input: nothing reads it back.

interface ViewLine {
  readonly text: string;
  readonly comment?: string;
}

// The comment column of the grammar's example; a longer line takes its comment two spaces after it.
const COMMENT_COLUMN = 49;
const MIN_COMMENT_GAP = 2;

// Members the view shows through others, or that only name the operation: the kind and name (the operationId
// line), the op shorthand and resource (the path), `safe` and `callerKinds` (the method and the access), and the
// docs, extensions and origin, which describe rather than decide.
const SHOWN_THROUGH_OTHERS: ReadonlySet<string> = new Set([
  "kind",
  "id",
  "name",
  "op",
  "resource",
  "safe",
  "callerKinds",
  "docs",
  "extensions",
  "origin",
]);

// The members the view writes a line or block for.
const RENDERED: ReadonlySet<string> = new Set([
  "surface",
  "method",
  "path",
  "access",
  "csrf",
  "scopes",
  "requires",
  "params",
  "unknownQuery",
  "input",
  "idempotency",
  "concurrency",
  "responses",
  "errors",
  "fieldRights",
  "cache",
  "paging",
  "filteredBy",
  "owner",
  "degradable",
  "budgetMs",
  "deadlineHeader",
  "deprecated",
  "relays",
  "upstream",
  "maturity",
  "internal",
  "format",
  "tags",
]);

type Locations = SourceMap["locations"];

export function explainOperationText(
  ir: ContractIR,
  operation: Operation,
  locations: Locations,
): string {
  const where = (value: unknown) => provenance(value, locations);
  const lines: ViewLine[] = [
    { text: `# seampact explain ${ir.api.id}.${operation.id}` },
    {
      text: `operationId: ${operation.id}`,
      comment: [operation.op === undefined ? "" : `ops.${operation.op}`, where(operation)]
        .filter((part) => part !== "")
        .join(", "),
    },
    { text: `surface: ${operation.surface}` },
    { text: `method: ${operation.method}` },
    { text: `path: ${operation.path}` },
    ...accessLines(operation.access, where),
    ...memberLine("csrf", operation.csrf, csrfValue, where),
    ...block(
      "scopes",
      operation.scopes.map((scope) => ({
        text: `  ${scope.scope}: ${sourceText(scope.source)}`,
        comment: where(scope),
      })),
    ),
    ...block(
      "requires",
      operation.requires.map((requirement) => ({
        text: `  - ${flow(requirementValue(requirement))}`,
        comment: [where(requirement), subjectDefaulted(requirement) ? DEFAULTED_SUBJECT : ""]
          .filter((part) => part !== "")
          .join("; "),
      })),
    ),
    ...block("params", paramLines(operation, where)),
    ...memberLine("unknownQuery", operation.unknownQuery, unknownQueryValue, where),
    ...inputLines(operation, where),
    ...memberLine("idempotency", operation.idempotency, idempotencyValue, where),
    ...memberLine("concurrency", operation.concurrency, concurrencyValue, where),
    ...block(
      "responses",
      operation.responses.map((response) => ({
        text: `  - ${flow(responseValue(response))}`,
        comment: where(response),
      })),
    ),
    ...block("errors", errorLines(ir, operation, where)),
    ...block(
      "fieldRights",
      operation.fieldRights.map((fieldRight) => ({
        text: `  - ${flow({ schema: fieldRight.schema, pointer: fieldRight.pointer, right: fieldRight.right, direction: fieldRight.direction, ...(fieldRight.inputPolicy === undefined ? {} : { inputPolicy: fieldRight.inputPolicy }), ...(fieldRight.always === undefined ? {} : { always: fieldRight.always }) })}`,
        comment: where(fieldRight),
      })),
    ),
    ...memberLine("cache", operation.cache, withoutProvenance, where),
    ...memberLine("paging", operation.paging, pagingValue, where),
    ...memberLine("filteredBy", operation.filteredBy, (value) => value, where),
    ...memberLine("owner", operation.owner, withoutProvenance, where),
    ...memberLine("degradable", operation.degradable, withoutProvenance, where),
    ...memberLine("budgetMs", operation.budgetMs, (value) => value, where),
    ...memberLine("deadlineHeader", operation.deadlineHeader, (value) => value, where),
    ...memberLine("deprecated", operation.deprecated, deprecatedValue, where),
    ...memberLine("relays", operation.relays, (ref) => `${ref.api}.${ref.id}`, where),
    ...(operation.upstream.length === 0 ? [] : [{ text: `upstream: ${flow(operation.upstream)}` }]),
    {
      text: `maturity: ${flow(maturityValue(operation.maturity))}`,
      comment: where(operation.maturity),
    },
    ...(operation.internal ? [{ text: "internal: true" }] : []),
    { text: `format: ${operation.format}` },
    ...(operation.tags.length === 0 ? [] : [{ text: `tags: ${flow(operation.tags)}` }]),
    ...notShownLine(operation),
  ];

  return `${lines.map(lineText).join("\n")}\n`;
}

type Where = (value: unknown) => string;

function lineText(line: ViewLine): string {
  if (line.comment === undefined || line.comment === "") return line.text;

  const padding = Math.max(COMMENT_COLUMN - line.text.length, MIN_COMMENT_GAP);

  return `${line.text}${" ".repeat(padding)}# ${line.comment}`;
}

function block(key: string, items: readonly ViewLine[]): ViewLine[] {
  return items.length === 0 ? [] : [{ text: `${key}:` }, ...items];
}

function memberLine<T>(
  key: string,
  value: T | undefined,
  render: (value: T) => unknown,
  where: Where,
): ViewLine[] {
  if (value === undefined) return [];

  return [{ text: `${key}: ${flow(render(value))}`, comment: where(value) }];
}

function accessLines(access: Operation["access"], where: Where): ViewLine[] {
  const comment = where(access);

  if (access.kind === "identity" && "schemes" in access) {
    return [
      { text: `identity: ${access.identity}`, comment },
      { text: `schemes: ${flow(access.schemes)}` },
    ];
  }

  if (access.kind === "optional" && "onRefused" in access) {
    return [
      { text: `identity: ${access.identity}`, comment },
      { text: `schemes: ${flow(access.schemes)}` },
      { text: `access: ${flow({ optionalAuth: access.reason, onRefused: access.onRefused })}` },
    ];
  }

  if (access.kind === "public" && "reason" in access)
    return [{ text: `access: ${flow({ public: access.reason })}`, comment }];

  return [{ text: `access: ${flow(withoutProvenance(access))}`, comment }];
}

function csrfValue(csrf: NonNullable<Operation["csrf"]>): unknown {
  if (csrf.kind === "derived" && "header" in csrf) return csrf.header;

  if (csrf.kind === "exempt" && "reason" in csrf) return { exempt: csrf.reason };

  return withoutProvenance(csrf);
}

function idempotencyValue(idempotency: NonNullable<Operation["idempotency"]>): unknown {
  if (idempotency.kind === "derived" && "header" in idempotency)
    return {
      header: idempotency.header,
      required: idempotency.required,
      replayHeader: idempotency.replayHeader,
      lifetimeMs: idempotency.lifetimeMs,
      enforce: idempotency.enforce,
    };

  if (idempotency.kind === "exempt" && "reason" in idempotency)
    return { exempt: idempotency.reason };

  return withoutProvenance(idempotency);
}

function unknownQueryValue(unknownQuery: Operation["unknownQuery"]): unknown {
  return unknownQuery.policy === "ignore" && "reason" in unknownQuery
    ? { ignore: unknownQuery.reason }
    : unknownQuery.policy;
}

function concurrencyValue(concurrency: NonNullable<Operation["concurrency"]>): unknown {
  return { version: sourceText(concurrency.version), field: concurrency.field };
}

function pagingValue(paging: NonNullable<Operation["paging"]>): unknown {
  const { sortKeys, ...rest } = withoutProvenance(paging);

  return Array.isArray(sortKeys) && sortKeys.length > 0
    ? {
        ...rest,
        sortKeys: sortKeys.map((key) => (isRecord(key) ? key.key : key)),
      }
    : rest;
}

function deprecatedValue(deprecated: NonNullable<Operation["deprecated"]>): unknown {
  const { successor, ...rest } = withoutProvenance(deprecated);

  return isRecord(successor)
    ? { ...rest, successor: `${String(successor.api)}.${String(successor.id)}` }
    : rest;
}

function maturityValue(maturity: Operation["maturity"]): unknown {
  return withoutProvenance(maturity);
}

const DEFAULTED_SUBJECT = "the subject defaults to the member id";

function subjectDefaulted(requirement: Operation["requires"][number]): boolean {
  const { subject } = recordOf(requirement);

  return isRecord(subject) && subject.defaulted === true;
}

function requirementValue(requirement: Operation["requires"][number]): unknown {
  const { kind, entry, subject, origin, derivedFrom, ...rest } = recordOf(requirement);
  const value: Record<string, unknown> = { ...rest };

  if (isRecord(subject)) value.subject = sourceText(subject.source);

  if (entry !== undefined) value.entry = entry;

  return kind === "right" || kind === "rule" ? value : { kind, ...value };
}

function inputLines(operation: Operation, where: Where): ViewLine[] {
  const input = operation.input;

  if (input === undefined) return [];

  const lines: ViewLine[] = [{ text: `input: ${typeText(input.schema)}`, comment: where(input) }];

  if (input.media !== JSON_MEDIA) lines.push({ text: `inputMedia: ${flow(input.media)}` });

  return [...lines, { text: `bodyLimitBytes: ${input.bodyLimitBytes}` }];
}

const JSON_MEDIA = "application/json";

function paramLines(operation: Operation, where: Where): ViewLine[] {
  const located = [
    ...operation.params.path.map((param) => ({ in: "path", param })),
    ...operation.params.query.map((param) => ({ in: "query", param })),
    ...operation.params.header.map((param) => ({ in: "header", param })),
  ];

  return located.map(({ in: place, param }) => ({
    text: `  ${place}.${param.name}: ${flow({ type: typeText(param.type), required: param.required })}`,
    comment: where(param),
  }));
}

function responseValue(response: Operation["responses"][number]): unknown {
  return {
    status: response.status,
    shape: response.shape,
    ...(response.body === undefined ? {} : { body: typeText(response.body) }),
    ...(response.media === undefined || response.media === JSON_MEDIA
      ? {}
      : { media: response.media }),
    ...(response.headers.length === 0
      ? {}
      : { headers: response.headers.map((header) => header.name) }),
  };
}

const NOT_IN_REGISTRY = "not in the error registry";

// The operation's codes with the status the registry gives each, by status; equal statuses keep the IR's order.
function errorLines(ir: ContractIR, operation: Operation, where: Where): ViewLine[] {
  const statusOf = (code: string) => ir.errors[code]?.http.status;

  return operation.errors
    .map((error, index) => ({ error, index, status: statusOf(error.code) }))
    .sort((left, right) => (left.status ?? 0) - (right.status ?? 0) || left.index - right.index)
    .map(({ error, status }) => ({
      text: `  - ${flow({ status: status ?? NOT_IN_REGISTRY, code: error.code })}`,
      comment: where(error),
    }));
}

// Nested members the view leaves out, by the list they sit in; the members it renders or only comments are absent.
const NESTED_RENDERED: Readonly<Record<string, ReadonlySet<string>>> = {
  params: new Set(["name", "type", "required", "origin", "derivedFrom"]),
  errors: new Set(["code", "origin", "derivedFrom"]),
  "responses.headers": new Set(["name"]),
};

function nestedNotShown(operation: Operation): string[] {
  const lists: Record<string, readonly unknown[]> = {
    params: [...operation.params.path, ...operation.params.query, ...operation.params.header],
    errors: operation.errors,
    "responses.headers": operation.responses.flatMap((response) => response.headers),
  };

  return Object.entries(lists).flatMap(([list, items]) => {
    const rendered = NESTED_RENDERED[list] ?? new Set<string>();
    const members = items.flatMap((item) => (isRecord(item) ? Object.entries(item) : []));
    const left = members
      .filter(([member, value]) => !rendered.has(member) && !isEmptyValue(value))
      .map(([member]) => `${list}.${member}`);

    return [...new Set(left)];
  });
}

function notShownLine(operation: Operation): ViewLine[] {
  const notShown = [
    ...Object.entries(operation)
      .filter(([member]) => !RENDERED.has(member) && !SHOWN_THROUGH_OTHERS.has(member))
      .filter(([, value]) => !isEmptyValue(value))
      .map(([member]) => member),
    ...nestedNotShown(operation),
  ].sort();

  return notShown.length === 0 ? [] : [{ text: `# not shown yet: ${notShown.join(", ")}` }];
}

function isEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;

  if (isRecord(value)) return Object.keys(value).length === 0;

  return value === undefined || value === false;
}

// A type use as the grammar writes it: a schema name, a scalar type, `[items]`, or its kind.
function typeText(type: unknown): string {
  if (!isRecord(type)) return String(type);

  if (type.kind === "ref") return String(type.schema);

  if (type.kind === "scalar") return String(type.format ?? type.scalar ?? type.type);

  if (type.kind === "enum") return String(type.enum);

  if (type.kind === "array") return `[${typeText(type.items)}]`;

  return String(type.kind);
}

// A value source as the grammar writes it: `path.taskId`, `host`, `address/24`, `resolver`.
function sourceText(source: unknown): string {
  if (!isRecord(source)) return String(source);

  if (source.resolver === true) return "resolver";

  if (typeof source.name === "string") return `${String(source.in)}.${source.name}`;

  if (typeof source.holderField === "string") return `holderField.${source.holderField}`;

  if (typeof source.prefixBits === "number") return `${String(source.in)}/${source.prefixBits}`;

  return String(source.in);
}

function withoutProvenance(value: object): Record<string, unknown> {
  const { origin, derivedFrom, ...rest } = recordOf(value);

  return rest;
}

function recordOf(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

// Where an element comes from: its derivation and the declarations it was derived from, then the node that set it.
function provenance(value: unknown, locations: Locations): string {
  if (!isRecord(value)) return "";

  const parts: string[] = [];
  const derivedFrom = value.derivedFrom;

  if (isRecord(derivedFrom)) {
    parts.push(String(derivedFrom.derivation));

    if (Array.isArray(derivedFrom.from))
      parts.push(...derivedFrom.from.map((origin) => originText(origin, locations)));
  }

  if (value.origin !== undefined) parts.push(originText(value.origin, locations));

  return [...new Set(parts)].join(", ");
}

// `file:line` through the side table; `built in` for a core declaration, which has no file; the side-table key when
// the table has no entry (a bundle source carries none, and another api's element is located in that api's table).
function originText(origin: unknown, locations: Locations): string {
  if (!isRecord(origin)) return String(origin);

  if (origin.layer === "core") return "built in";

  const key = `${String(origin.layer)}#${String(origin.pointer)}`;
  const location = origin.api === undefined ? locations[key] : undefined;

  if (location !== undefined) return `${location.file}:${location.line}`;

  return origin.api === undefined ? key : `api ${String(origin.api)}, ${key}`;
}

// A YAML flow value: plain identifiers and numbers as they are, every other string double-quoted.
function flow(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(flow).join(", ")}]`;

  if (isRecord(value)) {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .map(([key, member]) => `${key}: ${flow(member)}`);

    return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
  }

  if (typeof value === "string")
    return PLAIN_TEXT.test(value) && !YAML_KEYWORD.test(value) ? value : JSON.stringify(value);

  return String(value);
}

const PLAIN_TEXT = /^[A-Za-z_/][\w./-]*$/;
// Words a YAML reader takes for a boolean or null when written plain.
const YAML_KEYWORD = /^(true|false|null|yes|no|on|off|y|n)$/i;
