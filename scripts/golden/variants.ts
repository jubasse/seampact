import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse } from "yaml";
import { seededRandom } from "./seeded-random.ts";

// The inline = include generator: it reads a contract folder into plain trees (every `$include` and `$file`
// resolved), then writes it back with random mappings moved to `$include` files and random example values moved
// to `$file` files. Every variant must compile to the same IR bytes as the folder itself (ADR 0002, the
// byte-identity rule).

export type Tree = { [key: string]: TreeValue };
export type TreeValue = Tree | TreeValue[] | string | number | boolean | null;

/** The files that stay as they are: the workspace file lists apis and takes no `$include`. */
const FIXED_FILES = new Set(["workspace.yaml"]);

/** Keys whose value is data: only a `$file` is processed inside, an `$include` is data. */
const DATA_KEYS = new Set(["example", "examples", "default", "value"]);

/** The mapping of named tree nodes: it holds no `$include` key (ADR 0002 section 2). */
const NODE_MAP_KEY = "routes";

const MOVE_SLICE_PROBABILITY = 0.35;
const MOVE_NODE_PROBABILITY = 0.3;
const MOVE_DATA_PROBABILITY = 0.5;
const FRAGMENT_PROBABILITY = 0.3;
const IDENTIFIER_KEY = /^[A-Za-z_$][\w.$-]*$/;

function isTree(value: TreeValue | undefined): value is Tree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFile(root: string, path: string): TreeValue {
  return parse(readFileSync(join(root, path), "utf8")) as TreeValue;
}

function pointerTarget(document: TreeValue, pointer: string): TreeValue {
  let current = document;

  for (const segment of pointer.split("/").slice(1)) {
    if (!isTree(current) || !(segment in current)) {
      throw new Error(`the pointer ${pointer} reaches no mapping`);
    }

    current = current[segment] as TreeValue;
  }

  return current;
}

function resolveInclude(root: string, directory: string, reference: string): Tree {
  const [file = "", fragment] = reference.split("#");
  const path = posix.join(directory, file);
  const document = parseFile(root, path);
  const included = fragment === undefined ? document : pointerTarget(document, fragment);

  if (!isTree(included)) throw new Error(`${reference} is not a mapping`);

  return resolveTree(root, posix.dirname(path), included, false) as Tree;
}

/** The tree with every `$include` merged in place and every `$file` replaced by its content. */
function resolveTree(
  root: string,
  directory: string,
  value: TreeValue,
  inData: boolean,
): TreeValue {
  if (Array.isArray(value)) return value.map((item) => resolveTree(root, directory, item, inData));

  if (!isTree(value)) return value;

  const keys = Object.keys(value);
  const fileReference = value.$file;

  if (keys.length === 1 && typeof fileReference === "string") {
    return parseFile(root, posix.join(directory, fileReference));
  }

  const resolved: Tree = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "$include" && !inData) {
      const references = Array.isArray(child) ? child : [child];

      for (const reference of references) {
        Object.assign(resolved, resolveInclude(root, directory, String(reference)));
      }

      continue;
    }

    resolved[key] = resolveTree(root, directory, child as TreeValue, inData || DATA_KEYS.has(key));
  }

  return resolved;
}

/** One folder of contract files, every file as a plain tree. */
export function readContractTrees(root: string, files: readonly string[]): Map<string, Tree> {
  return new Map(
    files.map((file) => [
      file,
      resolveTree(root, posix.dirname(file), parseFile(root, file), false) as Tree,
    ]),
  );
}

export interface ContractVariant {
  files: Map<string, string>;
  /** The `$include` and `$file` directives the variant uses. */
  directives: number;
}

class VariantWriter {
  readonly files = new Map<string, string>();
  directives = 0;
  private partCount = 0;

  private readonly random: () => number;
  private readonly moving: boolean;

  constructor(random: () => number, moving: boolean) {
    this.random = random;
    this.moving = moving;
  }

  /** The relative path from a file's folder to a new part file below `parts/`. */
  private newPart(directory: string, extension: string): { path: string; reference: string } {
    const path = `parts/part${this.partCount++}.${extension}`;
    const relative = posix.relative(directory, path);

    return { path, reference: relative.startsWith(".") ? relative : `./${relative}` };
  }

  writeFile(path: string, tree: Tree): void {
    const moving = this.moving && !FIXED_FILES.has(path);

    this.files.set(
      path,
      `${this.mapping(tree, 0, posix.dirname(path), moving, false).join("\n")}\n`,
    );
  }

  private key(name: string): string {
    return IDENTIFIER_KEY.test(name) || /^\d+$/.test(name) ? name : JSON.stringify(name);
  }

  private mapping(
    map: Tree,
    indent: number,
    directory: string,
    mayInclude: boolean,
    isNodeMap: boolean,
  ): string[] {
    const names = Object.keys(map);
    const pad = " ".repeat(indent);
    const slice = mayInclude && !isNodeMap ? this.chooseSlice(names.length) : undefined;
    const lines: string[] = [];

    names.forEach((name, position) => {
      if (slice !== undefined && position >= slice.start && position < slice.end) {
        if (position === slice.start) {
          lines.push(this.includeSlice(map, names.slice(slice.start, slice.end), pad, directory));
        }

        return;
      }

      lines.push(
        ...this.entry(name, map[name] as TreeValue, indent, directory, mayInclude, isNodeMap),
      );
    });

    return lines;
  }

  private chooseSlice(length: number): { start: number; end: number } | undefined {
    if (length === 0 || this.random() >= MOVE_SLICE_PROBABILITY) return undefined;

    const start = Math.floor(this.random() * length);

    return { start, end: start + 1 + Math.floor(this.random() * (length - start)) };
  }

  private includeSlice(map: Tree, names: string[], pad: string, directory: string): string {
    const part = this.newPart(directory, "yaml");
    const partDirectory = posix.dirname(part.path);
    const moved: Tree = {};

    for (const name of names) moved[name] = map[name] as TreeValue;

    const viaFragment = this.random() < FRAGMENT_PROBABILITY;
    const body = this.mapping(moved, viaFragment ? 2 : 0, partDirectory, true, false).join("\n");

    this.files.set(part.path, viaFragment ? `Fragment:\n${body}\nOther: { x: 1 }\n` : `${body}\n`);
    this.directives++;

    return `${pad}$include: ${part.reference}${viaFragment ? "#/Fragment" : ""}`;
  }

  private entry(
    name: string,
    value: TreeValue,
    indent: number,
    directory: string,
    mayInclude: boolean,
    inNodeMap: boolean,
  ): string[] {
    const pad = " ".repeat(indent);
    const label = `${pad}${this.key(name)}:`;

    if (isTree(value) && DATA_KEYS.has(name)) return this.dataEntry(label, name, value, directory);

    if (!isTree(value) || Object.keys(value).length === 0)
      return [`${label} ${JSON.stringify(value)}`];

    if (inNodeMap && mayInclude && this.random() < MOVE_NODE_PROBABILITY) {
      const part = this.newPart(directory, "yaml");

      this.files.set(
        part.path,
        `${this.mapping(value, 0, posix.dirname(part.path), true, false).join("\n")}\n`,
      );
      this.directives++;

      return [`${label} { $include: ${part.reference} }`];
    }

    return [
      label,
      ...this.mapping(value, indent + 2, directory, mayInclude, name === NODE_MAP_KEY),
    ];
  }

  private dataEntry(label: string, name: string, value: Tree, directory: string): string[] {
    if (name === "value" && this.moving && this.random() < MOVE_DATA_PROBABILITY) {
      const part = this.newPart(directory, "json");

      this.files.set(part.path, `${JSON.stringify(value, null, 2)}\n`);
      this.directives++;

      return [`${label} { $file: ${part.reference} }`];
    }

    return [`${label} ${JSON.stringify(value)}`];
  }
}

/** One variant of the contract: with `moving` false the folder written back whole, else with random moves. */
export function contractVariant(
  trees: ReadonlyMap<string, Tree>,
  seed: number,
  moving: boolean,
): ContractVariant {
  const writer = new VariantWriter(seededRandom(seed), moving);

  for (const [path, tree] of trees) writer.writeFile(path, tree);

  return { files: writer.files, directives: writer.directives };
}
