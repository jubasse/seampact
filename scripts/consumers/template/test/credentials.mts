// The credentials every consumer's hooks honour and the http suite run passes to its cases.
import { createHmac } from "node:crypto";

/** A signed-in user: `Authorization: Bearer <userToken>`. */
export const USER_TOKEN = "seampact-user-token";

/** The user id the user token authenticates; the reference declares ids as UUIDs. */
export const USER_ID = "00000000-0000-4000-8000-000000000001";

/** A user whose `throttle` decision denies with `retryAfterMs`. */
export const THROTTLED_USER_TOKEN = "seampact-throttled-user-token";

/** The user id the throttled user token authenticates. */
export const THROTTLED_USER_ID = "00000000-0000-4000-8000-000000000002";

export const THROTTLE_RETRY_AFTER_MS = 1500;

/** The service identity's bearer token, a JWT the service hooks accept as is (header and claims fixed). */
export const SERVICE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXJ2aWNlIjoiY2F0YWxvZyIsInVzZXJJZCI6InVzZXItMSJ9.c2VhbXBhY3QtdGVzdA";

/** The service the service token stands for. */
export const SERVICE_NAME = "catalog";

/** The Stripe signature scheme's key id and its one valid secret. */
export const STRIPE_KEY_ID = "stripe";

export const STRIPE_SECRET = "whsec_seampact_test_secret";

const MILLISECONDS_PER_SECOND = 1000;

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/**
 * The `Stripe-Signature` value for a body, signed over `JSON.stringify(body)`: the bytes the generated client
 * sends, so the server verifies what it receives.
 */
export function stripeSignature(
  body: unknown,
  secret: string = STRIPE_SECRET,
  nowMs: number = Date.now(),
): string {
  const timestamp = String(Math.floor(nowMs / MILLISECONDS_PER_SECOND));
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${JSON.stringify(body)}`)
    .digest("hex");

  return `t=${timestamp},v1=${mac}`;
}
