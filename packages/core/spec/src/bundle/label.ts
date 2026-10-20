import manifestSchema from "../../schemas/bundle/manifest.schema.json" with { type: "json" };

// A manifest name or version (`$defs/label`): printable ASCII with no space, so every language orders the packs
// alike and prints a label as it is.

const LABEL_PATTERN = new RegExp(manifestSchema.$defs.label.pattern, "u");
const LABEL_MAX_LENGTH = manifestSchema.$defs.label.maxLength;

/** Why `label` is not a manifest name or version, or undefined when it is one. */
export function bundleLabelProblem(label: string): string | undefined {
  if (label.length > LABEL_MAX_LENGTH) return `is longer than ${LABEL_MAX_LENGTH} characters`;

  if (!LABEL_PATTERN.test(label))
    return "is empty or holds a character outside printable ASCII (a space, a control or a non-ASCII character)";

  return undefined;
}
