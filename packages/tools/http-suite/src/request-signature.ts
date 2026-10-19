// The request signature schemes the runner computes for a case's `sign` member, over the exact body bytes it sends.
import { createHmac } from "node:crypto";

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, the timestamped scheme Stripe webhooks use. */
export const STRIPE_V1_SCHEME = "stripe-v1";

const MILLISECONDS_PER_SECOND = 1000;

/** The signature header value for `body` at `nowMs` (the current time by default). */
export function signRequestBody(
  scheme: string,
  secret: string,
  body: string,
  nowMs: number = Date.now(),
): string {
  if (scheme !== STRIPE_V1_SCHEME) {
    throw new Error(
      `unknown signature scheme '${scheme}'; the runner signs with '${STRIPE_V1_SCHEME}'`,
    );
  }

  const timestamp = String(Math.floor(nowMs / MILLISECONDS_PER_SECOND));
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  return `t=${timestamp},v1=${mac}`;
}
