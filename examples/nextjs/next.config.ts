import type { NextConfig } from "next";

const API_URL_VARIABLE = "NEXT_PUBLIC_API_URL";

// Without it the build would bake in an undefined base URL and the first call would fail in the browser.
if (!process.env[API_URL_VARIABLE])
  throw new Error(`${API_URL_VARIABLE} is not set: copy .env.example to .env, or export it.`);

const nextConfig: NextConfig = {
  // The contract answers `/v1/notes/7/` itself (404) instead of Next.js redirecting it.
  skipTrailingSlashRedirect: true,
  // The workspace packages ship TypeScript sources that import each other with `.js` specifiers, which only webpack maps
  // back to `.ts`. Installed from npm, the packages ship compiled files and Turbopack, Next.js 16's default, builds too.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };

    return config;
  },
};

export default nextConfig;
