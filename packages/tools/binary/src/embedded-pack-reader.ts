import type { LoadReader } from "@seampact/compiler";

export interface EmbeddedPackage {
  // The npm name, such as `@seampact/pack-hal`.
  name: string;
  // File name to text, as the package holds them.
  files: Readonly<Record<string, string>>;
}

const NODE_MODULES = "node_modules";

export interface EmbeddedPackReader extends LoadReader {
  // `embedded:<package>/<file>` for a file this reader served from an embedded package; undefined for any other.
  embeddedLabel(file: string): string | undefined;
}

const EMBEDDED_LABEL_PREFIX = "embedded:";

// Wraps a reader so the embedded packages exist as `node_modules/<name>` at the topmost directory the pack walk
// reaches (ADR 0002 section 2). The walk goes upward from the workspace root, so a pack installed anywhere at or
// above the root is found first; the embedded copy answers only where the wrapped reader has nothing.
export function readerWithEmbeddedPacks(
  base: LoadReader,
  packages: readonly EmbeddedPackage[],
): EmbeddedPackReader {
  const tree = embeddedTree(base.ascent, packages);
  const served = new Set<string>();

  return {
    ascent: base.ascent,
    readText(file, maxBytes) {
      const found = base.readText(file, maxBytes);

      if (found !== undefined) return found;

      const text = tree.files.get(normalized(file));

      if (text === undefined) return undefined;

      served.add(normalized(file));

      return new TextEncoder().encode(text).length > maxBytes ? { tooLarge: true } : { text };
    },
    listDir(dir) {
      const names = base.listDir(dir);
      const embedded = tree.directories.get(normalized(dir));

      if (embedded === undefined) return names;

      return [...new Set([...(names ?? []), ...embedded])];
    },
    realPath(file) {
      const real = base.realPath(file);

      if (real !== undefined) return real;

      const key = normalized(file);

      return tree.files.has(key) || tree.directories.has(key) ? key : undefined;
    },
    embeddedLabel(file) {
      const key = normalized(file);

      return served.has(key) ? tree.labels.get(key) : undefined;
    },
  };
}

interface EmbeddedTree {
  // Root-relative file path to text.
  files: Map<string, string>;
  // Root-relative directory path to the names the embedded packages put in it.
  directories: Map<string, Set<string>>;
  // Root-relative file path to its `embedded:` label.
  labels: Map<string, string>;
}

function embeddedTree(ascent: number, packages: readonly EmbeddedPackage[]): EmbeddedTree {
  const tree: EmbeddedTree = { files: new Map(), directories: new Map(), labels: new Map() };
  const top = Array.from({ length: ascent }, () => "..").join("/");

  for (const { name, files } of packages) {
    const packageDirectory = normalized(`${top}/${NODE_MODULES}/${name}`);

    for (const [fileName, text] of Object.entries(files)) {
      const file = `${packageDirectory}/${fileName}`;

      tree.files.set(file, text);
      tree.labels.set(file, `${EMBEDDED_LABEL_PREFIX}${name}/${fileName}`);
      addToParents(tree.directories, file, normalized(top));
    }
  }

  return tree;
}

// Registers `path` in its parent directory, then that directory in its own parent, up to and including `top`.
function addToParents(directories: Map<string, Set<string>>, path: string, top: string): void {
  let child = path;

  while (child !== top) {
    const separator = child.lastIndexOf("/");
    const parent = separator === -1 ? "." : child.slice(0, separator);
    const names = directories.get(parent) ?? new Set<string>();

    names.add(child.slice(separator + 1));
    directories.set(parent, names);

    if (parent === top) return;

    child = parent;
  }
}

// `./a//b/` and `a/b` are the same key; the root itself is `.`.
function normalized(path: string): string {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");

  return parts.length === 0 ? "." : parts.join("/");
}
