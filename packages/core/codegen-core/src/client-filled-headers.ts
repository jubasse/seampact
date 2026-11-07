import { isKnownVariant, type Operation } from "@seampact/spec/ir";

// The request headers a generated client fills on its own: the idempotency key of a derived policy and the
// deadline header. The client's method type makes them optional, and a query key leaves them out, since they
// change on every call; one helper so the client and the queries never disagree on the list.

/** The headers the client fills for one operation, and whether its method needs a timeout from the caller. */
export interface ClientFilledHeaders {
  readonly idempotency?: { readonly header: string; readonly replayHeader: string };
  // Lower-case request keys, as the client keys request headers.
  readonly filledHeaderKeys: string[];
  // A deadline header with no budget: the caller passes the timeout the header carries.
  readonly needsTimeout: boolean;
}

export function clientFilledHeadersOf(operation: Operation): ClientFilledHeaders {
  const { idempotency, deadlineHeader, budgetMs } = operation;
  const derived =
    idempotency !== undefined &&
    isKnownVariant("Idempotency", idempotency) &&
    idempotency.kind === "derived"
      ? { header: idempotency.header, replayHeader: idempotency.replayHeader }
      : undefined;
  const filledHeaders = [
    ...(derived === undefined ? [] : [derived.header]),
    ...(deadlineHeader === undefined ? [] : [deadlineHeader]),
  ];

  return {
    ...(derived === undefined ? {} : { idempotency: derived }),
    filledHeaderKeys: filledHeaders.map((header) => header.toLowerCase()),
    needsTimeout: deadlineHeader !== undefined && budgetMs === undefined,
  };
}
