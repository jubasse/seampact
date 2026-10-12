// Bounds on what one load reads and builds, so a hostile or broken contract fails with a located
// diagnostic instead of exhausting memory or the stack. Each is generous for a hand-written
// contract: the worked example of ADR 0002 is about two thousand nodes and a dozen levels deep.

/** Bytes in one file; a larger file is refused unread (`seampact/load/file-too-large`). */
export const LOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Levels of nesting, counted through `$include` and `$file` (`seampact/load/too-deep`). */
export const LOAD_MAX_DEPTH = 256;

/** Nodes one load may build, every api together (`seampact/load/expansion-limit`). */
export const LOAD_MAX_NODES = 200_000;
