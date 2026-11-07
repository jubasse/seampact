export type KeyPath = readonly (string | number)[];

// A key path as the config problems print it: `targets[1].link.validators`.
export function formatKeyPath(path: KeyPath): string {
  return path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment}]`;

      return index === 0 ? segment : `.${segment}`;
    })
    .join("");
}
