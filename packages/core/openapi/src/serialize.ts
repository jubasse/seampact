import { stringify } from "yaml";
import type { JsonObject } from "./json-value.js";

// A document as byte-stable YAML: the emitter's key order, no anchors, no folded lines, LF and a final newline.

export function serializeDocument(document: JsonObject): string {
  return stringify(document, { aliasDuplicateObjects: false, lineWidth: 0, minContentWidth: 0 });
}
