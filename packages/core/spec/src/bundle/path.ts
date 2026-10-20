import manifestSchema from "../../schemas/bundle/manifest.schema.json" with { type: "json" };

// The portable-path rule of a bundle file: POSIX, relative to the bundle root, under `sources/` or `ir/`, each
// segment of `[A-Za-z0-9._@+-]` and neither `.` nor `..`. With ASCII only, code-unit order is the same in every
// language and no Unicode normalisation or case-mapping question arises. The schema holds the pattern.

/** The pattern of the schema's `$defs/path`, the one source of the rule. */
export const BUNDLE_PATH_PATTERN = new RegExp(manifestSchema.$defs.path.pattern, "u");

export const BUNDLE_PATH_MAX_LENGTH = manifestSchema.$defs.path.maxLength;

const TOP_DIRECTORIES = ["sources", "ir"];
const SEGMENT_CHARACTER = /^[A-Za-z0-9._@+-]$/u;

/** Why `path` is not a portable bundle path, or undefined when it is one. */
export function bundlePathProblem(path: string): string | undefined {
  if (path.length > BUNDLE_PATH_MAX_LENGTH)
    return `is longer than ${BUNDLE_PATH_MAX_LENGTH} characters`;

  const segments = path.split("/");

  if (!TOP_DIRECTORIES.includes(segments[0] ?? "") || segments.length < 2)
    return "is not a file under sources/ or ir/";

  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..")
      return `has an empty, '.' or '..' segment`;

    const unportable = [...segment].find((character) => !SEGMENT_CHARACTER.test(character));

    if (unportable !== undefined)
      return `holds ${JSON.stringify(unportable)}, outside the portable characters A-Z a-z 0-9 . _ @ + -`;
  }

  if (!BUNDLE_PATH_PATTERN.test(path)) return "does not match the portable path pattern";

  return undefined;
}

/** The key two paths share when they differ only in ASCII letter case (a case-insensitive file system). */
export function bundlePathFold(path: string): string {
  return path.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}
