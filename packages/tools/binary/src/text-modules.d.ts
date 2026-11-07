// The build bundles a `.yaml` file, and a specifier ending in `?text`, as the file's text (esbuild `text` loader).
declare module "*.yaml" {
  const text: string;

  export default text;
}

declare module "*/package.json?text" {
  const text: string;

  export default text;
}
