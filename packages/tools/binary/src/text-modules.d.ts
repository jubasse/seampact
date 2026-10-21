// The build bundles a `.yaml` file as its text (esbuild `text` loader).
declare module "*.yaml" {
  const text: string;

  export default text;
}
