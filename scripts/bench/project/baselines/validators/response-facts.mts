// What the three validator files share about the responses: the answer of a response check and the contract's
// date-time and name bounds.
export interface RouteOutput {
  readonly issues: readonly string[];
  /** The body cut to the declared members; the body as received when it has issues. */
  readonly body: unknown;
}

export const DATE_TIME =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
export const NAME_MAX = 100;
