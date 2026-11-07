import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeServer, LOOPBACK, type LoopbackServer, listenOnLoopback } from "./loopback.ts";

// A loopback npm registry: each package's packument and tarball over `node:http`, enough for
// `npm install --registry`. The tarballs are what `npm pack` writes from a package directory.

const run = promisify(execFile);

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export interface RegistryPackage {
  readonly name: string;
  readonly version: string;
  readonly tarball: Uint8Array;
}

/** The environment npm runs under in the smoke tests: no user config, no `npm_config_*` inherited from pnpm. */
export function isolatedNpmEnvironment(work: string): NodeJS.ProcessEnv {
  const userConfig = join(work, "npmrc");

  writeFileSync(userConfig, "");

  const inherited = Object.entries(process.env).filter(
    ([key]) => !key.toLowerCase().startsWith("npm_config_"),
  );

  return {
    ...Object.fromEntries(inherited),
    npm_config_userconfig: userConfig,
    npm_config_cache: join(work, "npm-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

/** `npm pack` of the package directory, read back as bytes. */
export async function packNpmPackage(directory: string, work: string): Promise<Uint8Array> {
  const destination = join(work, "packed");

  mkdirSync(destination, { recursive: true });

  const packed = await run(NPM, ["pack", "--json", "--pack-destination", destination], {
    cwd: directory,
    env: isolatedNpmEnvironment(work),
    shell: process.platform === "win32",
  });
  // npm 7 to 11 print an array of summaries, npm 12 an object of them by package name.
  const summaries: unknown = JSON.parse(packed.stdout);
  const [summary] = Array.isArray(summaries) ? summaries : Object.values(Object(summaries));
  const filename: unknown = Reflect.get(Object(summary), "filename");

  if (typeof filename !== "string") throw new Error(`npm pack in ${directory} named no tarball`);

  return new Uint8Array(readFileSync(join(destination, filename)));
}

/** Serves each package's packument at `/<name>` and its tarball at `/<name>/-/<name>-<version>.tgz`. */
export async function startRegistry(packages: readonly RegistryPackage[]): Promise<LoopbackServer> {
  const routes = new Map<string, { type: string; body: Uint8Array }>();
  const server = createServer((request, response) => {
    const route = routes.get(decodeURIComponent(request.url ?? ""));

    if (route === undefined) {
      response.writeHead(404).end();

      return;
    }

    response.writeHead(200, { "content-type": route.type, "content-length": route.body.length });
    response.end(route.body);
  });

  const url = `http://${LOOPBACK}:${await listenOnLoopback(server)}`;

  for (const each of packages) {
    const tarballPath = `/${each.name}/-/${each.name}-${each.version}.tgz`;
    const packument = {
      name: each.name,
      "dist-tags": { latest: each.version },
      versions: {
        [each.version]: {
          name: each.name,
          version: each.version,
          dist: {
            tarball: `${url}${tarballPath}`,
            integrity: `sha512-${createHash("sha512").update(each.tarball).digest("base64")}`,
            shasum: createHash("sha1").update(each.tarball).digest("hex"),
          },
        },
      },
    };

    routes.set(`/${each.name}`, {
      type: "application/json",
      body: new TextEncoder().encode(JSON.stringify(packument)),
    });
    routes.set(tarballPath, { type: "application/octet-stream", body: each.tarball });
  }

  return { url, close: () => closeServer(server) };
}
