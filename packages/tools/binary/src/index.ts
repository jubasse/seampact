// The standalone compiler binary: the CLI entry the single executable wraps, the commands it runs on native target entries only, and the reader serving the embedded first-party packs.

export { BINARY_NATIVE_ONLY_COMMANDS } from "./binary-refusals.js";
export {
  type EmbeddedPackage,
  type EmbeddedPackReader,
  readerWithEmbeddedPacks,
} from "./embedded-pack-reader.js";
