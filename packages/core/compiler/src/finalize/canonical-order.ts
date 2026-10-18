import { type IrWriter, walkIrInstance } from "@seampact/spec/ir";
import type { DraftIR } from "../pipeline/seam.js";
import { finalizeIsRecord } from "./record.js";
import { finalizeSerializeJson } from "./serialize.js";

// The canonical order of the IR's arrays (ADR 0004 section 9): each array of the "Sorted" column is sorted by its
// key, then by the element's canonical bytes on a tie; every other array keeps the order its pass wrote. Names,
// codes and keys compare by UTF-16 code units and statuses as integers, so the order depends on no locale. Records
// need no order here: the serialiser sorts their members. It sorts finalize's own copy of the draft in place.

type Comparator<T> = (a: T, b: T) => number;

/** Compares two texts by their UTF-16 code units, the order of RFC 8785. */
export const finalizeCompareText: Comparator<string> = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const compareNumber: Comparator<number> = (a, b) => a - b;

// Compares by each key in turn: the first that differs decides.
function byKeys<T>(...keys: readonly Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const compare of keys) {
      const order = compare(a, b);

      if (order !== 0) return order;
    }

    return 0;
  };
}

// The value at `path` below an array element, which the walk hands over untyped.
function memberAt(item: unknown, path: readonly string[]): unknown {
  let current = item;

  for (const member of path) {
    if (!finalizeIsRecord(current) || !Object.hasOwn(current, member)) return undefined;
    current = current[member];
  }

  return current;
}

// An absent text sorts first, as an empty one.
const byText =
  (...path: string[]): Comparator<unknown> =>
  (a, b) => {
    const textOf = (item: unknown) => {
      const value = memberAt(item, path);

      return typeof value === "string" ? value : "";
    };

    return finalizeCompareText(textOf(a), textOf(b));
  };

// An absent number sorts first, as zero; `false` before `true`.
const byNumber =
  (...path: string[]): Comparator<unknown> =>
  (a, b) => {
    const numberOf = (item: unknown) => {
      const value = memberAt(item, path);

      return typeof value === "number" ? value : value === true ? 1 : 0;
    };

    return compareNumber(numberOf(a), numberOf(b));
  };

const byValue = byText();

const byCanonicalBytes: Comparator<unknown> = (a, b) =>
  finalizeCompareText(finalizeSerializeJson(a), finalizeSerializeJson(b));

const byValueSource = (side: "from" | "to"): Comparator<unknown> =>
  byKeys(byText(side, "in"), byText(side, "name"), byNumber(side, "prefixBits"));

const byHeaderUse = byKeys(byText("header"), byText("for"));

// An operation's errors sort by their code's status, then code: a code with no declaration fails the IR
// invariants after this and sorts last meanwhile.
function byErrorStatus(errors: Readonly<Record<string, IrWriter.ErrorDecl>>): Comparator<unknown> {
  const statusOf = (item: unknown) => {
    const code = memberAt(item, ["code"]);

    if (typeof code !== "string" || !Object.hasOwn(errors, code)) return Number.MAX_SAFE_INTEGER;

    return errors[code]?.http.status ?? Number.MAX_SAFE_INTEGER;
  };

  return byKeys((a, b) => compareNumber(statusOf(a), statusOf(b)), byText("code"));
}

// The key of each "Sorted" row of ADR 0004 section 9, by `Definition.member`.
function sortedArrayKeys(
  errors: Readonly<Record<string, IrWriter.ErrorDecl>>,
): ReadonlyMap<string, Comparator<unknown>> {
  return new Map<string, Comparator<unknown>>([
    ["ApiDocument.surfaces", byValue],
    ["Cache.perCallerKind", byText("caller")],
    ["Cache.vary", byValue],
    ["ContractIR.features", byValue],
    ["ContractIR.kinds", byValue],
    ["ContractIR.operations", byText("id")],
    ["CredentialIdentity.errors", byValue],
    ["CredentialIdentity.headers", byHeaderUse],
    ["CredentialSchemes.optionalRead", byValue],
    ["CredentialSchemes.read", byValue],
    ["CredentialSchemes.write", byValue],
    ["Degradable.paths", byValue],
    ["Enum.directions", byValue],
    ["ExtensionKeyDecl.places", byValue],
    ["IdentityAccess.schemes", byValue],
    [
      "Lint.allows",
      byKeys(
        byText("rule"),
        byText("at", "api"),
        byText("at", "layer"),
        byText("at", "pointer"),
        byNumber("subtree"),
      ),
    ],
    ["MapSchema.directions", byValue],
    ["ObjectSchema.directions", byValue],
    ["Operation.bindings", byKeys(byValueSource("from"), byValueSource("to"))],
    ["Operation.callerKinds", byValue],
    ["Operation.errors", byErrorStatus(errors)],
    ["Operation.features", byValue],
    ["Operation.fieldRights", byKeys(byText("schema"), byText("pointer"), byText("direction"))],
    ["Operation.principalRequires", byText("field")],
    ["Operation.responses", byNumber("status")],
    ["Operation.tags", byValue],
    ["OperationError.roles", byText("role")],
    ["OptionalAccess.schemes", byValue],
    ["Paging.sortKeys", byText("key")],
    ["PagingStyle.handlerResult", byValue],
    ["Right.errors", byValue],
    ["Rule.errors", byValue],
    ["Scalar.directions", byValue],
    ["Scope.errors", byValue],
    ["SignedIdentity.errors", byValue],
    ["SignedIdentity.headers", byHeaderUse],
    ["UnionSchema.directions", byValue],
    ["UnionSchema.variants", byText("tag")],
  ]);
}

/** The `Definition.member` rows finalize sorts, for the test against ADR 0004 section 9. */
export const finalizeSortedArrayRows = (): string[] => [...sortedArrayKeys({}).keys()];

/** Sorts the "Sorted" arrays of `ir`, finalize's copy of the draft, in place (ADR 0004 section 9). */
export function finalizeCanonicalOrder(ir: DraftIR): void {
  const keys = sortedArrayKeys(ir.errors);

  // The walk visits an object before its members, so an array is sorted before its elements are walked.
  walkIrInstance(ir, (node) => {
    if (node.kind !== "object" || node.definition === undefined) return;

    for (const [member, value] of Object.entries(node.value)) {
      const key = keys.get(`${node.definition}.${member}`);

      if (key !== undefined && Array.isArray(value)) value.sort(byKeys(key, byCanonicalBytes));
    }
  });
}
