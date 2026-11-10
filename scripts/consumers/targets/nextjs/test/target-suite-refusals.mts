// The cases beyond the shared ones the Next.js consumer refuses.
export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "not-found-doubled-slash":
    "Next.js redirects a path with '//' with a 308 before the route handler runs, so the api's 404 is not reachable (ADR 0030 'Routes')",
  "mount-mismatch-refused-at-first-request":
    "the Next.js consumer starts no boot variant app, so its mount mismatch is not reproduced (ADR 0030 'Routes')",
};
