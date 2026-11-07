// The shapes of a measured route and the requests the parity probe and the load driver send to it.
export interface BenchRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** A request both servers refuse with the same status: exactly `status` when given, else any 4xx. */
export interface ProbeRefusal {
  readonly what: string;
  readonly request: BenchRequest;
  readonly status?: number;
}

/**
 * Requests sent in order to each server. The last answer must replay the first (status and body), or carry
 * `status`; both servers must answer the sequence alike.
 */
export interface ProbeSequence {
  readonly what: string;
  readonly requests: readonly BenchRequest[];
  readonly last: "replays the first" | { readonly status: number };
}

export interface BenchRoute {
  readonly id: string;
  readonly title: string;
  /** The status the contract declares for the valid request; both servers must answer it. */
  readonly successStatus: number;
  /** The request number `serial`; a route that needs a fresh key per request reads it. */
  request(serial: number): BenchRequest;
  /** A request the contract refuses with a 400 on both servers: an unknown key. */
  refusedRequest(): BenchRequest;
  /** Body members the parity probe ignores, such as an id a handler generates. */
  readonly volatileMembers: readonly string[];
  /** Refusals that prove a boundary step runs: the decider, the signature check. */
  readonly refusals?: readonly ProbeRefusal[];
  /** Sequences that prove the idempotency claim runs: a replay, a changed body under the same key. */
  readonly sequences?: readonly ProbeSequence[];
}
