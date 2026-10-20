import manifestSchema from "../../schemas/bundle/manifest.schema.json" with { type: "json" };

// The portable-path rule of a bundle file: POSIX, relative to the bundle root, under `sources/` or `ir/`, each
// segment of `[A-Za-z0-9._@+-]`, not ending in `.` (so neither `.` nor `..`) and not a Windows device name before
// its first `.`. With ASCII only, code-unit order is the same in every language and no Unicode normalisation or
// case-mapping question arises; with no trailing dot or device name, every path is one file on Windows too. The
// schema holds the patterns.

/** The pattern of the schema's `$defs/path`, the one source of the rule. */
export const BUNDLE_PATH_PATTERN = new RegExp(manifestSchema.$defs.path.pattern, "u");

/** The schema's `$defs/path` `not` pattern: a segment naming a Windows device. */
export const BUNDLE_PATH_DEVICE_PATTERN = new RegExp(manifestSchema.$defs.path.not.pattern, "u");

export const BUNDLE_PATH_MAX_LENGTH = manifestSchema.$defs.path.maxLength;

const TOP_DIRECTORIES = ["sources", "ir"];
const SEGMENT_CHARACTER = /^[A-Za-z0-9._@+-]$/u;
const DEVICE_STEM = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/u;

/** Why `path` is not a portable bundle path, or undefined when it is one. */
export function bundlePathProblem(path: string): string | undefined {
  if (path.length > BUNDLE_PATH_MAX_LENGTH)
    return `is longer than ${BUNDLE_PATH_MAX_LENGTH} characters`;

  const segments = path.split("/");

  if (!TOP_DIRECTORIES.includes(segments[0] ?? "") || segments.length < 2)
    return "is not a file under sources/ or ir/";

  for (const segment of segments) {
    const problem = segmentProblem(segment);

    if (problem !== undefined) return problem;
  }

  if (!BUNDLE_PATH_PATTERN.test(path) || BUNDLE_PATH_DEVICE_PATTERN.test(path))
    return "does not match the portable path pattern";

  return undefined;
}

function segmentProblem(segment: string): string | undefined {
  if (segment === "" || segment === "." || segment === "..")
    return `has an empty, '.' or '..' segment`;

  const unportable = [...segment].find((character) => !SEGMENT_CHARACTER.test(character));

  if (unportable !== undefined)
    return `holds U+${codePointHex(unportable)}, outside the portable characters A-Z a-z 0-9 . _ @ + -`;

  if (segment.endsWith("."))
    return `has the segment '${segment}', ending in '.' (Windows drops it)`;

  const stem = segment.split(".")[0] ?? "";

  if (DEVICE_STEM.test(bundlePathFold(stem)))
    return `has the segment '${segment}', a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9)`;

  return undefined;
}

// The character as U+XXXX: a path may come from an archive, so the character itself is never printed.
function codePointHex(character: string): string {
  return (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
}

/** The key two paths share when they differ only in ASCII letter case (a case-insensitive file system). */
export function bundlePathFold(path: string): string {
  return path.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}
