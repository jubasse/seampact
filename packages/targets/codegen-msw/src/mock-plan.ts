import type { PageFact, PlannedOperation, SuccessPlan } from "@seampact/codegen-core";
import {
  below,
  type IrLocation,
  type Refusal,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
} from "@seampact/codegen-core";
import { pageBodyLocation, pageBodyTemplate } from "@seampact/codegen-core/node-server";
import type { ContractIR, Operation, Template, WireFormat } from "@seampact/spec/ir";
import { mockPathOf, shadowingSiblingPaths } from "./mock-path.js";

// What the generated handlers tell the runtime about one operation (the runtime's `MockPlan` type checks the
// generated value): where it answers, how each declared success and error is written on the wire, and its example.
export interface MockPlan {
  operation: string;
  member: string;
  method: string;
  /** The contract path, as messages name it. */
  route: string;
  path: string;
  /** The MSW paths of the more specific same-method siblings, whose requests the handler lets through. */
  shadowedBy: string[];
  format: string;
  successes: SuccessWriting[];
  errors: Record<string, ErrorAttachment>;
  example?: { name: string; status: number; value: unknown };
}

export type SuccessWriting =
  | { status: number; shape: "empty" }
  | { status: number; shape: "payload"; media: string; payload: string[] }
  | {
      status: number;
      shape: "page";
      media: string;
      items: string[];
      facts: Pick<PageFact, "role" | "source">[];
    };

export interface ErrorWriting {
  status: number;
  media: string;
  body: Record<string, unknown>;
  mergeParams: boolean;
  noStore: boolean;
}

export interface ErrorAttachment {
  retryHeader?: { name: string; param: string; unit: string };
}

/** The error writings of an api, by format id, then by code. */
export type ErrorWritings = Record<string, Record<string, ErrorWriting>>;

const JSON_MEDIA = "application/json";
const NOT_MODIFIED = 304;
const PAYLOAD_SLOT = "payload";
const ITEMS_SLOT = "items";
const PARAMS_MERGE = "params";
const NULL_ABSENT = "null";

// The slots of an error body the code itself fills; the others (a trace id, the request's instance) are the
// server's own and stay absent in a mock answer, as the format's `absent` renders them.
const ERROR_CODE_SLOTS = ["code", "title", "status", "nature"] as const;

/** The success example the default handler answers: the first the operation declares for a success status. */
export function defaultExampleOf(operation: Operation): MockPlan["example"] {
  for (const [name, example] of Object.entries(operation.examples)) {
    if (example.status === undefined || example.request === true || example.error !== undefined)
      continue;

    return { name, status: example.status, value: structuredClone(example.value) };
  }

  return undefined;
}

export function mockPlanOf(
  operation: Operation,
  member: string,
  planned: PlannedOperation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): MockPlan {
  const successes = planned.plan.successes.flatMap((success) =>
    successWriting(success, operation, ir, location, refusals),
  );
  const example = pageWrappedExample(defaultExampleOf(operation), successes);

  if (planned.plan.notModified) successes.push({ status: NOT_MODIFIED, shape: "empty" });

  return {
    operation: operation.id,
    member,
    method: planned.plan.method,
    route: operation.path,
    path: mockPathOf(operation.path),
    shadowedBy: shadowingSiblingPaths(operation, ir),
    format: operation.format,
    successes,
    errors: errorAttachments(operation, planned),
    ...(example === undefined ? {} : { example }),
  };
}

// A page example is the item array (grammar section 12); the runtime writes a page from its handler result, where
// the items are the `items` member.
function pageWrappedExample(
  example: MockPlan["example"],
  successes: readonly SuccessWriting[],
): MockPlan["example"] {
  if (example === undefined) return undefined;

  const writing = successes.find((success) => success.status === example.status);

  if (writing?.shape !== "page" || !Array.isArray(example.value)) return example;

  return { ...example, value: { [ITEMS_SLOT]: example.value } };
}

function successWriting(
  success: SuccessPlan,
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): SuccessWriting[] {
  if (success.shape === "empty") return [{ status: success.status, shape: "empty" }];

  const format = formatOf(ir, operation);

  if (format === undefined) return [];

  if (success.shape === "page") return [pageWriting(success, operation, ir, location, refusals)];

  const shapeLocation = below({ member: "" }, "formats", format.id, "success", success.shape);

  refuseUnwrittenMembers(
    format.success[success.shape].body,
    [PAYLOAD_SLOT],
    below(shapeLocation, "body"),
    refusals,
  );

  return [
    { status: success.status, shape: "payload", media: JSON_MEDIA, payload: [...success.payload] },
  ];
}

// A page fact the handler result gives is written to where the client reads it; a link the server derives from a
// written cursor (the `next` link of `nextCursor`) comes with it. Any other fact is the server's to compute.
function pageWriting(
  success: Extract<SuccessPlan, { shape: "page" }>,
  operation: Operation,
  ir: ContractIR,
  location: IrLocation,
  refusals: Refusal[],
): SuccessWriting {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;
  const handlerResult: readonly string[] = style?.handlerResult ?? [];
  const written = success.facts.filter((fact) => handlerResult.includes(fact.role));
  const writtenRels = written.flatMap((fact) =>
    fact.source.from === "linkParam" ? [fact.source.rel] : [],
  );

  for (const fact of success.facts) {
    const isWritten = handlerResult.includes(fact.role);
    const isDerived = fact.source.from === "link" && writtenRels.includes(fact.source.rel);

    if (isWritten || isDerived) continue;

    refusals.push(
      refuseNotGeneratedYet(
        "mock.page.fact",
        `A page fact '${fact.role}' the handler result does not give`,
        below(location, "paging"),
      ),
    );
  }

  const body = pageBodyTemplate(ir, operation);
  const bodyFacts = written.flatMap((fact) => (fact.source.from === "body" ? [fact.role] : []));

  if (body !== undefined) {
    refuseUnwrittenMembers(
      body,
      [ITEMS_SLOT, ...bodyFacts],
      pageBodyLocation(ir, operation),
      refusals,
    );
  }

  return {
    status: success.status,
    shape: "page",
    media: JSON_MEDIA,
    items: [...success.items],
    facts: written.map((fact) => ({ role: fact.role, source: structuredClone(fact.source) })),
  };
}

// A success body the mock writes holds only objects around the slots it fills; a literal member, a record part or
// a slot only the server knows (the request path, the item's own URL, the format's meta) is refused by name.
function refuseUnwrittenMembers(
  template: Template,
  writtenSlots: readonly string[],
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (template.kind === "slot" && "slot" in template && writtenSlots.includes(template.slot))
    return;

  if (template.kind === "object" && "members" in template && template.merge === undefined) {
    template.members.forEach((member, index) => {
      refuseUnwrittenMembers(
        member.value,
        writtenSlots,
        below(location, "members", index, "value"),
        refusals,
      );
    });

    return;
  }

  refusals.push(
    refuseNotGeneratedYet(
      "mock.envelope.member",
      `A success body member of kind '${template.kind}' the mock does not fill`,
      location,
    ),
  );
}

function errorAttachments(
  operation: Operation,
  planned: PlannedOperation,
): Record<string, ErrorAttachment> {
  return Object.fromEntries(
    planned.plan.errors.map((planError) => {
      const retryHeader = operation.errors.find(
        (error) => error.code === planError.code,
      )?.retryHeader;
      const attachment: ErrorAttachment =
        retryHeader === undefined
          ? {}
          : {
              retryHeader: {
                name: retryHeader.name,
                param: retryHeader.param,
                unit: retryHeader.unit,
              },
            };

      return [planError.code, attachment];
    }),
  );
}

/** How each code the operations answer is written, per format: one body per code, whatever operation answers it. */
export function errorWritingsOf(
  ir: ContractIR,
  plans: readonly MockPlan[],
  refusals: Refusal[],
): ErrorWritings {
  const writings: ErrorWritings = {};

  for (const plan of plans) {
    const format = Object.hasOwn(ir.formats, plan.format) ? ir.formats[plan.format] : undefined;

    if (format === undefined) continue;

    const formatWritings = Object.hasOwn(writings, format.id) ? writings[format.id] : undefined;
    const codes = formatWritings ?? {};

    writings[format.id] = codes;

    for (const code of Object.keys(plan.errors).sort()) {
      const declaration = Object.hasOwn(ir.errors, code) ? ir.errors[code] : undefined;

      if (declaration === undefined || Object.hasOwn(codes, code)) continue;

      codes[code] = {
        status: declaration.http.status,
        media: format.error.media,
        body: errorBodyOf(
          format,
          {
            code,
            title: declaration.title,
            status: declaration.http.status,
            nature: declaration.nature,
          },
          below({ member: "" }, "formats", format.id, "error", "body"),
          refusals,
        ),
        mergeParams: isParamsMerge(format.error.body),
        noStore: declaration.noStore === true,
      };
    }
  }

  return sortedByKey(writings, (codes) => sortedByKey(codes, (writing) => writing));
}

function sortedByKey<Value, Sorted>(
  record: Record<string, Value>,
  sortValue: (value: Value) => Sorted,
): Record<string, Sorted> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap((key) => {
        const value = record[key];

        return value === undefined ? [] : [[key, sortValue(value)]];
      }),
  );
}

function isParamsMerge(body: Template): boolean {
  return body.kind === "object" && "members" in body && body.merge === PARAMS_MERGE;
}

// The format's error body with the code's own slots filled at generation; the params merge at answer time.
function errorBodyOf(
  format: WireFormat,
  codeSlots: Readonly<Record<string, unknown>>,
  location: IrLocation,
  refusals: Refusal[],
): Record<string, unknown> {
  const { body } = format.error;

  if (body.kind !== "object" || !("members" in body)) return {};

  const rendered: Record<string, unknown> = {};

  body.members.forEach((member, index) => {
    const memberLocation = below(location, "members", index);

    if (member.name.kind !== "text" || !("text" in member.name)) {
      refusals.push(
        refuseNotGeneratedYet(
          "mock.error.member",
          "An error body member named by a slot",
          memberLocation,
        ),
      );

      return;
    }

    const value = errorMemberValue(
      member.value,
      codeSlots,
      below(memberLocation, "value"),
      refusals,
    );

    if (value !== undefined) rendered[member.name.text] = value;
    else if (format.absent === NULL_ABSENT) rendered[member.name.text] = null;
  });

  return rendered;
}

function errorMemberValue(
  template: Template,
  codeSlots: Readonly<Record<string, unknown>>,
  location: IrLocation,
  refusals: Refusal[],
): unknown {
  if (template.kind === "literal" && "value" in template) return structuredClone(template.value);

  if (template.kind === "slot" && "slot" in template && template.path.length === 0) {
    return ERROR_CODE_SLOTS.some((slot) => slot === template.slot)
      ? codeSlots[template.slot]
      : undefined;
  }

  refusals.push(
    refuseNotGeneratedYet(
      "mock.error.member",
      `An error body member of kind '${template.kind}'`,
      location,
    ),
  );

  return undefined;
}

function formatOf(ir: ContractIR, operation: Operation): WireFormat | undefined {
  return Object.hasOwn(ir.formats, operation.format) ? ir.formats[operation.format] : undefined;
}

/** An operation the types link leaves out is an IR the compiler would not write. */
export function refuseMissingTypes(location: IrLocation): Refusal {
  return refuseInconsistentIr(
    "link.types.operation.missing",
    "The types link has no types for this operation",
    location,
  );
}
