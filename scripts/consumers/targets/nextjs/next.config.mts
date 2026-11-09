import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The sample app's sources are shared with the other Node consumers: `.mts` files that import each other with `.mjs`
// specifiers (NodeNext). Next.js compiles neither, so this consumer builds with `next build --webpack`, where an
// extension alias maps the specifiers and a loader strips the types of the `.mts` files. The generated tree needs
// neither: its imports are extensionless, which Turbopack resolves too (ADR 0030 "Placement").
const STRIP_TYPES_LOADER = fileURLToPath(new URL("./strip-types-loader.cjs", import.meta.url));

// The contract answers a trailing slash itself, and the http suite's control routes (`/__seampact/...`) reach their
// route files through a rewrite, since a folder that starts with an underscore is private in the App Router.
const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  // The http suite's package reads its case files from disk, so Node loads it as it is instead of Next bundling it.
  serverExternalPackages: ["@seampact/http-suite"],
  async rewrites() {
    return [{ source: "/__seampact/:name", destination: "/seampact-control/:name" }];
  },
  webpack(config) {
    config.resolve.extensionAlias = { ".mjs": [".mts", ".mjs"], ".js": [".ts", ".js"] };
    config.module.rules.unshift({ test: /\.mts$/, use: STRIP_TYPES_LOADER });

    return config;
  },
};

export default nextConfig;
