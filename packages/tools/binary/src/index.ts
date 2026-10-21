// The standalone compiler binary: the CLI entry the single executable wraps, the commands it refuses, and the reader serving the embedded first-party packs.

export { BINARY_REFUSAL_EXIT_CODE, binaryRefusal } from "./binary-refusals.js";
export { type EmbeddedPackage, readerWithEmbeddedPacks } from "./embedded-pack-reader.js";
