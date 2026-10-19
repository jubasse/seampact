// The cases beyond the shared ones the Hono consumer refuses, by case id, with the target bug the report names.
export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "etag-and-not-modified":
    'hono/compress weakens the boundary\'s ETag to W/"..." for a client that accepts gzip, and the shared Web outgoing check then drops it as foreign, so the reply has no ETag and no 304',
};
