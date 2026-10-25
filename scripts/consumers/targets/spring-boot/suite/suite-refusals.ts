// The cases the Spring Boot consumer does not run yet, by case id, with the release of the target that brings each:
// the consumer keeps the reference's core-path operations until spring-3 widens its filter (ADR 0022 "Delivery").
const PAYMENTS = "Calls the signed payments route, which comes with spring-3.";

export const SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": PAYMENTS,
  "every-operation-succeeds":
    "Calls every reference operation; those outside the core path come with spring-3.",
  "signed-webhook-without-csrf-or-key": PAYMENTS,
  "stale-webhook-signature": PAYMENTS,
};
