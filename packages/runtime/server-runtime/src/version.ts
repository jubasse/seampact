// The runtime's own version, which the release pipeline stamps at the generators' version (ADR 0025, G1). The
// generate-time check reads it from the app's install and the boot check compares the generated code with it; both
// read this constant, never the package manifest. It imports nothing, so a check can load it alone.

/** The version of this runtime; unreleased, the development version the generators of the same checkout stamp. */
export const SERVER_RUNTIME_VERSION = "0.0.0";
