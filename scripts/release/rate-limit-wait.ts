// The waits a release script spends on a registry's 429 Too Many Requests: a doubling pause, or the one the registry
// asks for in `Retry-After`, all of them under one total for the whole run, so a registry that keeps refusing fails
// the script well inside its job's timeout instead of holding it there.
import { setTimeout as delay } from "node:timers/promises";

const MILLISECONDS_PER_SECOND = 1000;
const WHOLE_SECONDS = /^\d+$/;

export type Pause = (milliseconds: number) => Promise<void>;

export const sleep: Pause = (milliseconds) => delay(milliseconds);

export class RateLimitWait {
  private waitedMilliseconds = 0;
  private nextPauseMilliseconds: number;
  private readonly totalWaitMilliseconds: number;
  private readonly pause: Pause;

  constructor(firstPauseMilliseconds: number, totalWaitMilliseconds: number, pause: Pause = sleep) {
    this.nextPauseMilliseconds = firstPauseMilliseconds;
    this.totalWaitMilliseconds = totalWaitMilliseconds;
    this.pause = pause;
  }

  /** The minutes waited so far, rounded up, for a message. */
  get waitedMinutes(): number {
    return Math.ceil(this.waitedMilliseconds / (60 * MILLISECONDS_PER_SECOND));
  }

  /**
   * Waits before the next attempt: the registry's own delay when it gave one, else the doubling pause, cut to what
   * is left of the total. Answers false, without waiting, once the total is spent.
   */
  async beforeRetry(retryAfterMilliseconds?: number): Promise<boolean> {
    const left = this.totalWaitMilliseconds - this.waitedMilliseconds;

    if (left <= 0) return false;

    const wanted = retryAfterMilliseconds ?? this.nextPauseMilliseconds;
    const pause = Math.min(wanted, left);

    this.nextPauseMilliseconds *= 2;
    this.waitedMilliseconds += pause;
    await this.pause(pause);

    return true;
  }
}

/** A `Retry-After` header in milliseconds: whole seconds or an HTTP date; `undefined` when absent or unreadable. */
export function retryAfterMilliseconds(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;

  const value = header.trim();

  if (WHOLE_SECONDS.test(value)) return Number(value) * MILLISECONDS_PER_SECOND;

  const date = Date.parse(value);

  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
