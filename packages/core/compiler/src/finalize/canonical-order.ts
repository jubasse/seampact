import type { IrWriter } from "@seampact/spec/ir";
import type { DraftIR, DraftOperation } from "../pipeline/seam.js";

// The canonical order of the IR's arrays (ADR 0004 section 9): the arrays of the "Sorted" column are sorted, every
// other array keeps the order its pass wrote. Names, codes and keys compare by UTF-16 code units and statuses as
// integers, so the order depends on no locale. Records need no order here: the serialiser sorts their members.
// It sorts the arrays of finalize's own copy of the draft in place, never the draft.

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

const byText =
  <T>(read: (item: T) => string | undefined): Comparator<T> =>
  (a, b) =>
    finalizeCompareText(read(a) ?? "", read(b) ?? "");

const byNumber =
  <T>(read: (item: T) => number | undefined): Comparator<T> =>
  (a, b) =>
    compareNumber(read(a) ?? 0, read(b) ?? 0);

const byValueSource: Comparator<IrWriter.ValueSource> = byKeys(
  byText((source) => source.in),
  byText((source) => source.name),
  byNumber((source) => source.prefixBits),
);

const byBinding: Comparator<IrWriter.Binding> = byKeys(
  (a, b) => byValueSource(a.from, b.from),
  (a, b) => byValueSource(a.to, b.to),
);

const byFieldRight: Comparator<IrWriter.FieldRight> = byKeys(
  byText((right) => right.schema),
  byText((right) => right.pointer),
  byText((right) => right.direction),
);

/** Sorts the "Sorted" arrays of `ir`, finalize's copy of the draft, in place (ADR 0004 section 9). */
export function finalizeCanonicalOrder(ir: DraftIR): void {
  ir.operations.sort(byText((operation) => operation.id));

  for (const operation of ir.operations) sortOperation(operation, ir.errors);

  for (const schema of Object.values(ir.schemas)) {
    schema.directions.sort(finalizeCompareText);

    if (schema.kind === "union") schema.variants.sort(byText((variant) => variant.tag));
  }

  for (const declaration of [...Object.values(ir.enums), ...Object.values(ir.scalars)])
    declaration.directions.sort(finalizeCompareText);

  for (const identity of Object.values(ir.identities)) {
    if (identity.kind !== "credential") continue;

    identity.schemes.read.sort(finalizeCompareText);
    identity.schemes.write.sort(finalizeCompareText);
    identity.schemes.optionalRead.sort(finalizeCompareText);
  }
}

function sortOperation(
  operation: DraftOperation,
  errors: Readonly<Record<string, IrWriter.ErrorDecl>>,
): void {
  // A code with no declaration fails the IR invariants after this; it sorts last meanwhile.
  const statusOf = (code: string) =>
    Object.hasOwn(errors, code) ? errors[code]?.http.status : Number.MAX_SAFE_INTEGER;

  operation.callerKinds?.sort(finalizeCompareText);
  operation.tags?.sort(finalizeCompareText);
  operation.responses?.sort(byNumber((response) => response.status));
  operation.errors?.sort(
    byKeys(
      byNumber((error) => statusOf(error.code)),
      byText((error) => error.code),
    ),
  );
  operation.fieldRights?.sort(byFieldRight);
  operation.bindings?.sort(byBinding);
  operation.cache?.vary.sort(finalizeCompareText);
  operation.paging?.sortKeys.sort(byText((sortKey) => sortKey.key));
}
