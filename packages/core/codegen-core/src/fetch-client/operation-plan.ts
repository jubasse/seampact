import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type OperationInput,
  type Param,
  type Response,
  type WireFormat,
} from "@seampact/spec/ir";
import { type ClientFilledHeaders, clientFilledHeadersOf } from "../client-filled-headers.js";
import { below, type IrLocation } from "../ir-location.js";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "../located-refusals.js";
import type { Refusal } from "../refusal.js";
import { type PageFact, pageReaderOf, payloadPathOf } from "./success-reader.js";

// What the generated client tells the runtime about one operation; the runtime's `OperationPlan` type checks the
// generated value.
export interface OperationPlan {
  method: string;
  path: string;
  query: { name: string; wire: QueryWireKind }[];
  headers: [key: string, wireName: string][];
  hasJsonBody: boolean;
  idempotency?: { header: string; replayHeader: string };
  budgetMs?: number;
  deadlineHeader?: string;
  successes: SuccessPlan[];
  notModified: boolean;
  errors: { code: string; status: number; params?: string[] }[];
}

const PLANNED_QUERY_WIRES = ["text", "number", "list"] as const;

type QueryWireKind = (typeof PLANNED_QUERY_WIRES)[number];

const PAYLOAD_SHAPES = ["item", "table", "list"] as const;

type PayloadShape = (typeof PAYLOAD_SHAPES)[number];

export type SuccessPlan =
  | { status: number; shape: "empty" }
  | { status: number; shape: PayloadShape; payload: string[] }
  | { status: number; shape: "page"; items: string[]; facts: PageFact[] };

// The headers the client fills itself, by request key, so the method type makes them optional.
export interface PlannedOperation {
  plan: OperationPlan;
  filledHeaderKeys: string[];
  needsTimeout: boolean;
}

const KNOWN_METHODS: readonly string[] = ["get", "post", "put", "patch", "delete"];
const JSON_MEDIA = "application/json";
const NOT_GENERATED_MEDIA: readonly string[] = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];
const SIMPLE_TYPE_KINDS: readonly string[] = ["scalar", "enum"];
const ETAG_DERIVATION = "cache.etag";
const ETAG_HEADER = "etag";
const NOT_MODIFIED = 304;
const FORM_STYLE = "form";
const KNOWN_QUERY_STYLES: readonly string[] = ["form", "deepObject"];
const NOT_GENERATED_QUERY_WIRES: readonly string[] = ["boolean", "object"];
const NOT_GENERATED_SHAPES: readonly string[] = ["binary", "redirect"];
const PAGING_DERIVATION = "paging.params";
const KNOWN_POSITIONS: readonly string[] = ["cursor", "page", "offset", "since"];

// The plan of one operation, every form the client cannot send or read refused by name into `refusals`.
export function planOperation(
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): PlannedOperation {
  refuseOperationForms(operation, location, refusals);

  const filled = clientFilledHeadersOf(operation);
  const idempotency = idempotencyPlan(operation, filled, location, refusals);
  const plan: OperationPlan = {
    method: methodOf(operation, location, refusals),
    path: operation.path,
    query: operation.params.query.flatMap((param, index) =>
      queryPlan(param, below(location, "params", "query", index), refusals),
    ),
    headers: operation.params.header.map((param, index) => {
      refuseNonSimpleType(param, "header", below(location, "params", "header", index), refusals);

      return [param.name.toLowerCase(), param.name];
    }),
    hasJsonBody: hasJsonBody(operation, ir, below(location, "input"), refusals),
    ...(idempotency === undefined ? {} : { idempotency }),
    ...(operation.budgetMs === undefined ? {} : { budgetMs: operation.budgetMs }),
    ...(operation.deadlineHeader === undefined ? {} : { deadlineHeader: operation.deadlineHeader }),
    successes: successPlans(operation, ir, location, refusals),
    notModified: operation.responses.some(isDerivedNotModified),
    errors: errorPlans(operation, ir, location, refusals),
  };

  operation.params.path.forEach((param, index) => {
    refuseNonSimpleType(param, "path", below(location, "params", "path", index), refusals);
  });

  return { plan, filledHeaderKeys: filled.filledHeaderKeys, needsTimeout: filled.needsTimeout };
}

function refuseOperationForms(
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (operation.deprecated !== undefined) {
    refusals.push(
      refuseNotGeneratedYet("deprecated", "A deprecated operation", below(location, "deprecated")),
    );
  }

  if (operation.degradable?.header !== undefined) {
    refusals.push(
      refuseNotGeneratedYet(
        "degradable.header",
        "A degraded-parts header",
        below(location, "degradable", "header"),
      ),
    );
  }
}

function methodOf(operation: Operation, location: IrLocation, refusals: Refusal[]): string {
  if (!KNOWN_METHODS.includes(operation.method)) {
    refusals.push(refuseUnknownValueAt(below(location, "method"), operation.method));
  }

  return operation.method;
}

function refuseNonSimpleType(
  param: Param,
  placement: "path" | "header",
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (SIMPLE_TYPE_KINDS.includes(param.type.kind)) return;

  refusals.push(
    refuseNotGeneratedYet(
      `${placement}.param.type`,
      `A ${placement} parameter of kind '${param.type.kind}'`,
      below(location, "type"),
    ),
  );
}

// `text` and `number` in `style: form`; a `list` in `style: form`, comma-separated, without brackets.
function queryPlan(
  param: Param,
  location: IrLocation,
  refusals: Refusal[],
): OperationPlan["query"] {
  const { wire } = param;

  if (wire === undefined) {
    refusals.push(
      refuseInconsistentIr("query.wire.missing", "A query parameter has no wire form", location),
    );

    return [];
  }

  const wireLocation = below(location, "wire");
  const before = refusals.length;

  if (!isPlannedQueryWire(wire.kind)) {
    refusals.push(
      NOT_GENERATED_QUERY_WIRES.includes(wire.kind)
        ? refuseNotGeneratedYet(
            "query.wire",
            `A '${wire.kind}' query value`,
            below(wireLocation, "kind"),
          )
        : refuseUnknownValueAt(below(wireLocation, "kind"), wire.kind),
    );

    return [];
  }

  if (wire.style !== FORM_STYLE) {
    refusals.push(
      KNOWN_QUERY_STYLES.includes(wire.style)
        ? refuseNotGeneratedYet(
            "query.style",
            `A '${wire.style}' query style`,
            below(wireLocation, "style"),
          )
        : refuseUnknownValueAt(below(wireLocation, "style"), wire.style),
    );
  }

  if (wire.kind === "list" && wire.explode) {
    refusals.push(
      refuseNotGeneratedYet(
        "query.list.explode",
        "A list sent as repeated keys",
        below(wireLocation, "explode"),
      ),
    );
  }

  if (wire.kind === "list" && wire.brackets) {
    refusals.push(
      refuseNotGeneratedYet(
        "query.list.brackets",
        "A list sent as 'name[]'",
        below(wireLocation, "brackets"),
      ),
    );
  }

  if (refusals.length > before) return [];

  return [{ name: param.name, wire: wire.kind }];
}

function isPlannedQueryWire(kind: string): kind is QueryWireKind {
  return PLANNED_QUERY_WIRES.some((planned) => planned === kind);
}

function hasJsonBody(
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): boolean {
  const { input } = operation;

  if (input === undefined) return false;

  if (input.media !== JSON_MEDIA) {
    const mediaLocation = below(location, "media");

    refusals.push(
      NOT_GENERATED_MEDIA.includes(input.media)
        ? refuseNotGeneratedYet("input.media", `A '${input.media}' body`, mediaLocation)
        : refuseUnknownValueAt(mediaLocation, input.media),
    );
  }

  refuseHeaderTaggedUnion(input, ir, location, refusals);

  return true;
}

function refuseHeaderTaggedUnion(
  input: OperationInput,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (input.schema.kind !== "ref" || !("schema" in input.schema)) return;

  const schemaId = input.schema.schema;
  const schema = Object.hasOwn(ir.schemas, schemaId) ? ir.schemas[schemaId] : undefined;

  if (schema === undefined || !isKnownVariant("Schema", schema)) return;

  if (schema.kind !== "union" || schema.tag.in !== "header") return;

  refusals.push(
    refuseNotGeneratedYet(
      "input.union.headerTag",
      "A request body chosen by a header",
      below(location, "schema"),
    ),
  );
}

// The client fills a derived key; an unknown kind is refused, an exemption fills nothing.
function idempotencyPlan(
  operation: Operation,
  filled: ClientFilledHeaders,
  location: IrLocation,
  refusals: Refusal[],
): OperationPlan["idempotency"] {
  const { idempotency } = operation;

  if (idempotency === undefined || idempotency.kind === "exempt") return undefined;

  if (filled.idempotency === undefined) {
    refusals.push(refuseUnknownValueAt(below(location, "idempotency", "kind"), idempotency.kind));

    return undefined;
  }

  return { header: filled.idempotency.header, replayHeader: filled.idempotency.replayHeader };
}

function isDerivedNotModified(response: Response): boolean {
  return response.status === NOT_MODIFIED && response.derivedFrom?.derivation === ETAG_DERIVATION;
}

function successPlans(
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): SuccessPlan[] {
  return operation.responses.flatMap((response, index) => {
    if (isDerivedNotModified(response)) return [];

    const responseLocation = below(location, "responses", index);

    refuseResponseHeaders(response, operation, responseLocation, refusals);

    return successPlan(response, operation, ir, responseLocation, refusals);
  });
}

// The format's success headers carry no paging role (ADR 0002 section 13): they reach the caller through `headers`.
function successPlan(
  response: Response,
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): SuccessPlan[] {
  const { status, shape } = response;
  // An undeclared format is refused once for the api, in `generate`.
  const format = Object.hasOwn(ir.formats, operation.format)
    ? ir.formats[operation.format]
    : undefined;

  if (shape === "empty") return [{ status, shape: "empty" }];

  if (isPayloadShape(shape)) {
    refuseNonJsonBody(response, location, refusals);

    if (format === undefined) return [];

    const formatShapeLocation = below({ member: "" }, "formats", format.id, "success", shape);
    const payload = payloadPathOf(
      format.success[shape].body,
      below(formatShapeLocation, "body"),
      refusals,
    );

    return payload === undefined ? [] : [{ status, shape, payload }];
  }

  if (shape === "page") {
    refuseNonJsonBody(response, location, refusals);

    return format === undefined
      ? []
      : pagePlan(response, operation, ir, format, location, refusals);
  }

  refusals.push(
    NOT_GENERATED_SHAPES.includes(shape)
      ? refuseNotGeneratedYet("response.shape", `A '${shape}' response`, below(location, "shape"))
      : refuseUnknownValueAt(below(location, "shape"), shape),
  );

  return [];
}

function isPayloadShape(shape: string): shape is PayloadShape {
  return PAYLOAD_SHAPES.some((payloadShape) => payloadShape === shape);
}

function pagePlan(
  response: Response,
  operation: Operation,
  ir: ContractIR,
  format: WireFormat,
  location: IrLocation,
  refusals: Refusal[],
): SuccessPlan[] {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;

  if (style === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "response.page.style.missing",
        "A page response has no paging style",
        location,
      ),
    );

    return [];
  }

  if (!KNOWN_POSITIONS.includes(style.position)) {
    refusals.push(
      refuseUnknownValueAt(below({ member: "" }, "pagings", style.id, "position"), style.position),
    );
  }

  const reader = pageReaderOf(style, format, refusals);

  if (reader === undefined) return [];

  return [{ status: response.status, shape: "page", items: reader.items, facts: reader.facts }];
}

function refuseNonJsonBody(response: Response, location: IrLocation, refusals: Refusal[]): void {
  if (response.media === JSON_MEDIA) return;

  refusals.push(
    refuseNotGeneratedYet(
      "response.media",
      `A '${response.media ?? "missing"}' response body`,
      below(location, "media"),
    ),
  );
}

// The client reads the headers of a page's paging style (`Link` included) through the page plan, and leaves `ETag` and the replay header to the caller through `headers`;
// typed response headers wait.
function refuseResponseHeaders(
  response: Response,
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): void {
  const replayHeader =
    operation.idempotency !== undefined && "replayHeader" in operation.idempotency
      ? operation.idempotency.replayHeader.toLowerCase()
      : undefined;

  response.headers.forEach((header, index) => {
    const name = header.name.toLowerCase();
    const isRead =
      (response.shape === "page" && header.derivedFrom?.derivation === PAGING_DERIVATION) ||
      (name === ETAG_HEADER && header.derivedFrom?.derivation === ETAG_DERIVATION) ||
      name === replayHeader;

    if (isRead) return;

    refusals.push(
      refuseNotGeneratedYet(
        "response.header",
        `The response header '${header.name}'`,
        below(location, "headers", index),
      ),
    );
  });
}

function errorPlans(
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): OperationPlan["errors"] {
  return operation.errors.flatMap((error, index) => {
    const declaration = Object.hasOwn(ir.errors, error.code) ? ir.errors[error.code] : undefined;

    if (declaration === undefined) {
      refusals.push(
        refuseInconsistentIr(
          "error.code.undeclared",
          `The error code '${error.code}' is not in the errors registry`,
          below(location, "errors", index, "code"),
        ),
      );

      return [];
    }

    const base = { code: error.code, status: declaration.http.status };

    if (declaration.params === undefined) return [base];

    const params = paramsMembers(
      declaration.params,
      ir,
      below({ member: "" }, "errors", error.code, "params"),
      refusals,
    );

    return params === undefined ? [] : [{ ...base, params }];
  });
}

// The property names of an error's params schema, picked from the problem body; an object schema only.
function paramsMembers(
  schemaId: string,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): string[] | undefined {
  const schema = Object.hasOwn(ir.schemas, schemaId) ? ir.schemas[schemaId] : undefined;

  if (schema === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "schema.ref.unresolved",
        `The schema '${schemaId}' is not declared`,
        location,
      ),
    );

    return undefined;
  }

  if (!isKnownVariant("Schema", schema) || schema.kind !== "object") {
    refusals.push(
      refuseNotGeneratedYet(
        "error.params.shape",
        `Error params of kind '${schema.kind}'`,
        location,
      ),
    );

    return undefined;
  }

  return schema.properties.map((property) => property.name);
}
