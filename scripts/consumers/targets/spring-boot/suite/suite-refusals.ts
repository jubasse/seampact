// The cases the Spring Boot consumer does not run, by case id, with the reason: none, since it serves every
// operation of the reference contract (ADR 0022 "Delivery").
export const SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {};

// The default cases the `pack:spring` profile cannot read yet, with the reason: gaps of the shared suite's pack
// adaptation, not of the boundary, which answers them as the default profile checks.
export const PACK_SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "limit-above-max-refused":
    "The pack adaptation renames the limit parameter in the request but not the issue pointer the case expects (/limit, answered /size).",
  "query-number-decoding":
    "The pack adaptation renames the limit parameter in the request but not the issue pointer the case expects (/limit, answered /size).",
  "outside-base-path-is-app-not-found":
    "The pack's reader reads an error code from the app's own 404, which no contract format writes.",
};
