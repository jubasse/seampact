// The cases the API Platform consumer does not run, by case id, with the reason. In api-platform-1 the boundary serves
// the API Platform routes but the reply path is not generated yet (ADR 0029 "Delivery"), so a case that ends in a
// handler's result or a declared error the handler returns waits for api-platform-2; the others run.
import { inputRulesNotYetRefusal } from "../../../../../packages/tools/http-suite/src/index.ts";
import { nativePagingRefusals } from "../../../paging-refusals.ts";

const WAITS_FOR_REPLY_PATH =
  "api-platform writes no reply from a handler's result before api-platform-2 (ADR 0029 Delivery); the boundary's refusals before the handler run";

const REPLY_PATH_CASES: readonly string[] = [
  "absolute-urls-from-public-origin",
  "batch-read-without-csrf-or-key",
  "bearer-beside-cookie-skips-csrf",
  "cache-family-headers",
  "changes-since-feed-and-stale-token",
  "channel-non-member-not-found",
  "deadline-passed-answers-timeout",
  "delete-answers-body",
  "deprecated-route-headers",
  "derived-errors-default-codes",
  "device-token-authenticates-device",
  "etag-and-not-modified",
  "every-cache-directive",
  "every-operation-succeeds",
  "handler-declared-error-answered",
  "head-runs-get-without-body",
  "idempotency-key-in-progress",
  "idempotency-key-reused",
  "idempotent-replay",
  "idempotent-replay-of-handler-error",
  "if-match-precondition",
  "internal-token-authenticates-service",
  "limit-above-max-clamped",
  "member-action-version-conflict",
  "optional-auth-refused-credential",
  "page-links-next-page",
  "query-list-repeat-filters",
  "refusal-before-handler-not-stored",
  "relay-sends-restricted-fields",
  "requirements-run-in-declared-order",
  "restricted-input-field-accepted-with-right",
  "restricted-input-field-kept-with-right",
  "restricted-input-field-stripped-without-right",
  "restricted-output-field-absent-from-lists-without-right",
  "restricted-output-field-absent-in-nested-array",
  "restricted-output-field-absent-without-right",
  "restricted-output-field-present-in-lists-with-right",
  "restricted-output-field-present-with-right",
  "sensitive-field-no-store",
  "service-write-without-actor-surface",
  "several-success-statuses",
  "signed-webhook-without-csrf-or-key",
  "split-sort-github-pages",
  "stale-body-version-conflict",
  "stale-delete-version-conflict",
  "stripe-list-more-and-exclusive-cursors",
  "throttle-bucket-reaches-decide-hook",
  "trace-context-relayed-to-handler",
  "undeclared-member-stripped",
  "undeclared-member-stripped-from-page-items",
];

export const API_PLATFORM_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...nativePagingRefusals("api-platform"),
  ...Object.fromEntries(REPLY_PATH_CASES.map((id) => [id, WAITS_FOR_REPLY_PATH])),
  ...inputRulesNotYetRefusal("api-platform", "1.1.x"),
};
