// The cases the Hono consumer refuses, by case id, with the target bug the report names.
export const SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "etag-and-not-modified":
    "a reply compressed by hono/compress loses the boundary's ETag, so a client that accepts gzip gets no ETag and no 304",
};
