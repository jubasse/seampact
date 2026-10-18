import { expect, test } from "vitest";
import everyMember from "../../schemas/ir/examples/every-member.ir.json" with { type: "json" };
import vectors from "../../vectors/ir/header-values.json" with { type: "json" };
import { checkIrInvariants } from "./invariants.js";
import { IR_SCHEMA_BASE } from "./schemas.js";
import { createAjv, mutateAt } from "./test-support.js";

type Vector = (typeof vectors.cases)[number];
type Fragment = Vector["fragment"];

const DEPRECATED = "/operations/2/deprecated";
const FRAGMENT_DEFINITIONS = {
  deprecated: "operation.schema.json#/$defs/Deprecation",
  degradable: "operation.schema.json#/$defs/Degradable",
  retryHeader: "operation.schema.json#/$defs/RetryHeader",
  wire: "ir.schema.json#/$defs/ApiWire",
} as const;
const validator = createAjv("strict");

// The test-only reference: each header value from the IR fragment and the request data alone.
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_SECOND = 1000;
const WEEKDAYS = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNRESERVED = /^[A-Za-z0-9\-._~]$/u;

// Days from 1970-01-01 of a proleptic Gregorian date, from its fields (no clock, no zone).
function daysFromEpoch(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146_097 + dayOfEra - 719_468;
}

function imfFixdate(date: string): string {
  const [year, month, day] = date.split("-");
  const weekday = WEEKDAYS[((daysFromEpoch(date) % 7) + 7) % 7];

  return `${weekday}, ${day} ${MONTHS[Number(month) - 1]} ${year} 00:00:00 GMT`;
}

const encodeSegment = (value: string): string =>
  [...new TextEncoder().encode(value)]
    .map((byte) => {
      const character = String.fromCharCode(byte);

      return UNRESERVED.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

function successorLink(fragment: Fragment, request: Vector["request"]): string {
  const path = String(fragment.successorPath).replace(/\{(\w+)\}/gu, (_, name: string) =>
    encodeSegment(String(request.pathParams?.[name as keyof typeof request.pathParams])),
  );
  const target = fragment.wire?.urls === "absolute" ? `${request.origin}${path}` : path;

  return `<${target}>; rel="${fragment.deprecated?.successorRel}"`;
}

function degradedList(fragment: Fragment, request: Vector["request"]): string | null {
  const degradedPaths: readonly string[] = request.degradedPaths ?? [];
  const degraded = (fragment.degradable?.paths ?? []).filter((path) =>
    degradedPaths.includes(path),
  );

  return degraded.length === 0 ? null : degraded.join(", ");
}

function retryAfter(fragment: Fragment, request: Vector["request"]): string {
  const delayMs = Number(request.params?.retryAfterMs);

  return fragment.retryHeader?.unit === "s"
    ? String(Math.ceil(delayMs / MILLISECONDS_PER_SECOND))
    : String(delayMs);
}

function referenceValue(vector: Vector): string | null {
  const { fragment, request } = vector;

  switch (vector.header) {
    case "deprecation":
      return `@${daysFromEpoch(String(fragment.deprecated?.since)) * SECONDS_PER_DAY}`;
    case "sunset":
      return imfFixdate(String(fragment.deprecated?.sunset));
    case "successorLink":
      return successorLink(fragment, request);
    case "degraded":
      return degradedList(fragment, request);
    default:
      return retryAfter(fragment, request);
  }
}

test("header-values vectors are valid fragments, their expected texts match the reference computation, and the refused dates break ir.deprecation.since", () => {
  expect(new Set(vectors.cases.map((vector) => vector.id)).size).toBe(vectors.cases.length);

  for (const vector of vectors.cases) {
    for (const [member, definition] of Object.entries(FRAGMENT_DEFINITIONS)) {
      if (!(member in vector.fragment)) continue;
      const isValid = validator.getSchema(`${IR_SCHEMA_BASE}${definition}`);

      expect(isValid?.(vector.fragment[member as keyof Fragment]), `${vector.id} ${member}`).toBe(
        true,
      );
    }

    if ("refused" in vector) {
      const ir = mutateAt(everyMember, DEPRECATED, (deprecated) => {
        Object.assign(deprecated, vector.fragment.deprecated);
      });

      expect(
        checkIrInvariants(ir).map((violation) => violation.id),
        vector.id,
      ).toContain(vector.refused);
      continue;
    }

    expect(referenceValue(vector), vector.id).toBe(vector.expected);
  }
});

test("the absolute successor links are built from the configured origin, never the request host", () => {
  const absolute = vectors.cases.filter((vector) => vector.fragment.wire?.urls === "absolute");

  expect(absolute.length).toBeGreaterThan(0);

  for (const vector of absolute) {
    expect(vector.request.origin, vector.id).not.toContain(String(vector.request.host));
    expect(vector.expected, vector.id).toMatch(new RegExp(`^<${vector.request.origin}/`, "u"));
  }
});
