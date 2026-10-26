// The cases the Laravel consumer does not run, by case id, with the reason. The consumer serves every operation of
// the reference contract, so no case waits for a later PR.
export const LARAVEL_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "pack-laravel-page-next-link":
    "Its next link is a query-only reference, as every target writes one under relative URLs, and the suite sends only a path starting with '/'; the pack:laravel describe block follows the link resolved against the page's URL instead.",
};
