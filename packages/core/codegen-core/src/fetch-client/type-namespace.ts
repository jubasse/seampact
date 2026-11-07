const NAMESPACE_SUFFIX = "Types";

/** `operations/input` is imported as `operationsInputTypes`; a module path is letters, digits, `-`, `_` and `/`. */
export function typeNamespaceName(module: string): string {
  const words = module.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  const camel = words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");

  return `${camel}${NAMESPACE_SUFFIX}`;
}
