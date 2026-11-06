import {
  type ContractIR,
  isIrCalendarDate,
  type Operation,
  type Origin,
  type Response,
  type ResponseHeader,
} from "@seampact/spec/ir";
import { below, type IrLocation } from "../ir-location.js";
import { refuseInconsistentIr, refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";
import type { SourceValue } from "./route-table-source.js";

// The response headers the route table writes from a response's own IR headers (ADR 0004 section 7): the
// deprecation, sunset and successor link of a deprecated operation, and the `ETag` of an item versioned by
// `If-Match` (grammar section 6). The other response headers are written from the members that derive them: the
// idempotency replay, `cache.etag` and the paging headers.

const CONCURRENCY_DERIVATION = "concurrency.version";
const HEADER_SOURCE = "header";
const MILLISECONDS_PER_SECOND = 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEAR_DIGITS = 4;
const DAY_DIGITS = 2;

type DeprecationSemantic = "deprecation" | "sunset" | "successorLink";

function isDeprecationSemantic(semantic: string | undefined): semantic is DeprecationSemantic {
  return semantic === "deprecation" || semantic === "sunset" || semantic === "successorLink";
}

/** The headers of one response the boundary writes from this table: a fixed text, the successor link, the ETag. */
export function responseHeaderEntries(
  ir: ContractIR,
  operation: Operation,
  response: Response,
  location: IrLocation,
  mount: string,
  refusals: Refusal[],
): SourceValue[] {
  return response.headers.flatMap((header, index) => {
    const entry = headerEntry(
      ir,
      operation,
      header,
      below(location, "headers", String(index)),
      mount,
    );

    if (entry === undefined) return [];

    if (isRefusal(entry)) {
      refusals.push(entry);

      return [];
    }

    return [entry];
  });
}

// Undefined for a header another member of the table writes.
function headerEntry(
  ir: ContractIR,
  operation: Operation,
  header: ResponseHeader,
  location: IrLocation,
  mount: string,
): HeaderEntry | Refusal | undefined {
  if (isDeprecationSemantic(header.semantic))
    return deprecationEntry(ir, operation, header.name, header.semantic, mount, location);

  if (header.derivedFrom?.derivation !== CONCURRENCY_DERIVATION) return undefined;

  return entityTagEntry(ir, operation, header.name, header.derivedFrom.from[0], location);
}

type HeaderEntry =
  | { readonly kind: "text"; readonly name: string; readonly value: string }
  | {
      readonly kind: "successorLink";
      readonly name: string;
      readonly path: string;
      readonly rel: string;
    }
  | { readonly kind: "entityTag"; readonly name: string; readonly field: string };

function isRefusal(entry: HeaderEntry | Refusal): entry is Refusal {
  return "code" in entry;
}

function deprecationEntry(
  ir: ContractIR,
  operation: Operation,
  name: string,
  semantic: DeprecationSemantic,
  mount: string,
  location: IrLocation,
): HeaderEntry | Refusal {
  const deprecated = operation.deprecated;

  if (deprecated === undefined)
    return refuseInconsistentIr(
      "ir.deprecation.headers",
      `A ${semantic} header on an operation that is not deprecated`,
      location,
    );

  if (semantic === "successorLink")
    return successorLinkEntry(ir, deprecated, name, mount, location);

  const date = semantic === "deprecation" ? deprecated.since : deprecated.sunset;

  if (date === undefined)
    return refuseInconsistentIr(
      "ir.deprecation.headers",
      `A ${semantic} header on an operation without its ${semantic} date`,
      location,
    );

  if (!isIrCalendarDate(date))
    return refuseInconsistentIr(
      "ir.deprecation.since",
      `The ${semantic} header's date is not a calendar date`,
      location,
    );

  return {
    kind: "text",
    name,
    value: semantic === "deprecation" ? deprecationValue(date) : sunsetValue(date),
  };
}

function successorLinkEntry(
  ir: ContractIR,
  deprecated: NonNullable<Operation["deprecated"]>,
  name: string,
  mount: string,
  location: IrLocation,
): HeaderEntry | Refusal {
  const successor = deprecated.successor;
  const rel = deprecated.successorRel;

  if (successor === undefined || rel === undefined)
    return refuseInconsistentIr(
      "ir.deprecation.headers",
      "A successor link header on an operation without its successor and relation",
      location,
    );

  if (successor.api !== ir.api.id)
    return refuseNotGeneratedYet(
      "deprecated.successor.otherApi",
      `The successor link to operation '${successor.id}' of api '${successor.api}'`,
      location,
    );

  const successorOperation = ir.operations.find((candidate) => candidate.id === successor.id);

  if (successorOperation === undefined)
    return refuseInconsistentIr(
      "ir.deprecation.successor",
      `The successor '${successor.id}' is no operation of the api`,
      location,
    );

  return { kind: "successorLink", name, path: `${mount}${successorOperation.path}`, rel };
}

// The calendar day at 00:00:00 UTC, from its fields alone: `setUTCFullYear` reads years below 100 as written.
function utcMidnight(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`'${date}' is no calendar date`);

  const midnight = new Date(0);

  midnight.setUTCFullYear(year, month - 1, day);

  return midnight;
}

/** RFC 9745: `@` and the unix seconds of the day at 00:00:00 UTC. */
export function deprecationValue(date: string): string {
  return `@${utcMidnight(date).getTime() / MILLISECONDS_PER_SECOND}`;
}

/** RFC 8594 and RFC 9110 section 5.6.7: the IMF-fixdate of the day at 00:00:00 GMT. */
export function sunsetValue(date: string): string {
  const midnight = utcMidnight(date);
  const day = String(midnight.getUTCDate()).padStart(DAY_DIGITS, "0");
  const month = MONTHS[midnight.getUTCMonth()];
  const year = String(midnight.getUTCFullYear()).padStart(YEAR_DIGITS, "0");

  return `${WEEKDAYS[midnight.getUTCDay()]}, ${day} ${month} ${year} 00:00:00 GMT`;
}

// The `ETag` of an item versioned by `If-Match`, from the item property the version is compared with. A read of
// the resource has no `concurrency`: its ETag is derived from the resource's, the origin its versioned writes name
// first, and they give the field.
function entityTagEntry(
  ir: ContractIR,
  operation: Operation,
  name: string,
  resourceOrigin: Origin | undefined,
  location: IrLocation,
): HeaderEntry | Refusal {
  if (operation.concurrency?.version.in === HEADER_SOURCE)
    return { kind: "entityTag", name, field: operation.concurrency.field };

  const fields = new Set(
    ir.operations.flatMap((candidate) => {
      const concurrency = candidate.concurrency;
      const origin = concurrency?.derivedFrom?.from[0];

      if (concurrency?.version.in !== HEADER_SOURCE || !isSameOrigin(origin, resourceOrigin))
        return [];

      return [concurrency.field];
    }),
  );
  const [field] = fields;

  if (field !== undefined && fields.size === 1) return { kind: "entityTag", name, field };

  if (fields.size > 1)
    return refuseInconsistentIr(
      "concurrency.etag.field",
      "The If-Match writes of the resource this ETag is derived from compare different fields",
      location,
    );

  return refuseNotGeneratedYet(
    "concurrency.etag.withoutWrite",
    "An ETag of a resource whose If-Match writes are not operations of this api",
    location,
  );
}

function isSameOrigin(left: Origin | undefined, right: Origin | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.layer === right.layer &&
    left.pointer === right.pointer
  );
}
