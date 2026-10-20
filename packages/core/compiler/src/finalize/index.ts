// The finalize stage (ADR 0006 section 1): pruning, canonical ids and ordering, the id collision check, IR validation and serialisation.

export { FINALIZE_ID_COLLISION_RULE } from "./collisions.js";
export { finalizeIr } from "./finalize.js";
export { finalizeCanonicalIr, finalizeSerializeIr, finalizeSerializeJson } from "./serialize.js";
