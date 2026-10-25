// The cases the Spring Boot consumer does not run yet, by case id, with the release of the target that brings each:
// the consumer keeps the reference's core-path operations until spring-3 widens its filter (ADR 0022 "Delivery").
const PAYMENTS = "Calls the signed payments route, which comes with spring-3.";
const UPDATE_TASK =
  "Calls a task write with a version token, whose concurrency check comes with spring-3.";
const PURGE_TASK = "Calls purgeTask, whose rule proofs come with spring-3.";

export const SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": PAYMENTS,
  "every-operation-succeeds":
    "Calls every reference operation; those outside the core path come with spring-3.",
  "member-action-version-conflict": UPDATE_TASK,
  "overridden-right-reaches-its-own-hook": UPDATE_TASK,
  "recent-auth-denied": PURGE_TASK,
  "recent-auth-proof-required": PURGE_TASK,
  "signed-webhook-without-csrf-or-key": PAYMENTS,
  "stale-body-version-conflict": UPDATE_TASK,
  "stale-webhook-signature": PAYMENTS,
  "unknown-enum-value-refused": UPDATE_TASK,
};
