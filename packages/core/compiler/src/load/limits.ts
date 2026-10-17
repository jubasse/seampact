// Bounds on what one load reads and builds, so a hostile or broken contract fails with a located
// diagnostic instead of exhausting time, memory or the stack. Each is generous for a hand-written
// contract: the worked example of ADR 0002 is about two thousand nodes and a dozen levels deep.
// The work and text limits are charged through the load's one budget (`budget.ts`).

/** Bytes in one file; a larger file is refused unread (`seampact/load/file-too-large`). */
export const LOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Levels of nesting, counted through `$include` and `$file`, and files in one chain of
 * `$include`, `$file` or pack `extends` (`seampact/load/too-deep`).
 */
export const LOAD_MAX_DEPTH = 256;

/**
 * Units of work one load may do, every api together (`seampact/load/expansion-limit`): a node
 * built, an `$include` target or `$file` site, a node merged into an api, a leaf origin or a
 * location written. A pointer or key longer than 256 characters costs one more unit per 256.
 */
export const LOAD_MAX_WORK = 2_000_000;

/**
 * Characters (UTF-16 code units) of the strings one load admits, keys included, counted for each
 * use of a file and each api a string reaches (`seampact/load/expansion-limit`).
 */
export const LOAD_MAX_TEXT = 64 * 1024 * 1024;
