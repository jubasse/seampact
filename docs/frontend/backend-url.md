# Point the client at your backend

The backend URL is the `baseUrl` you pass to `createClient`. seampact never writes it into the generated code: each environment gives its own.

Browser code has no `process.env`. `import.meta.env.VITE_X`, `process.env.NEXT_PUBLIC_X` and `process.env.EXPO_PUBLIC_X` are text the bundler replaces when it builds (or when the dev server serves the file), so the value is fixed in the shipped files. A browser only gets a value chosen at runtime from data a server sends it: Nuxt or SvelteKit runtime config, a `config.json` fetched at start, or no URL at all behind a same-origin proxy or route handler.

Create each browser client once and reuse it. Two apis on two backends: two variables, two clients.

## Where the URL comes from

| App | Read the URL from | Fixed when |
|---|---|---|
| Vite (React, Vue, Svelte) | `import.meta.env.VITE_API_URL` | build |
| Next.js, browser | `process.env.NEXT_PUBLIC_API_URL` | `next build` |
| Next.js, server | `process.env.API_URL` | each request |
| Nuxt | `useRuntimeConfig().public.apiUrl`, set by `NUXT_PUBLIC_API_URL` | server start |
| SvelteKit 2 | `env.PUBLIC_API_URL` from `$env/dynamic/public` | server start |
| SvelteKit 3 | a `public: true` variable of `defineEnvVars` | server start |
| Angular | `/config.json` fetched in `provideAppInitializer` | container start |
| Expo | `process.env.EXPO_PUBLIC_API_URL`, written exactly like this | bundle |
| Node | `process.env.NOTES_API_URL` | process start |

A build-time value stays in the image you promote from staging to production. To change it without a rebuild, see [Docker](#docker-one-image-for-every-environment).

Docs: [Vite](https://vite.dev/guide/env-and-mode), [Next.js](https://nextjs.org/docs/app/guides/environment-variables), [Nuxt](https://nuxt.com/docs/guide/going-further/runtime-config), [SvelteKit](https://svelte.dev/docs/kit/$env-dynamic-public), [Expo](https://docs.expo.dev/guides/environment-variables/).

## Vite

```ts
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
```

Put `VITE_API_URL=http://localhost:3000` in `.env.development`. Only `VITE_` variables reach the browser.

## Next.js

Server code reads any variable at runtime, without the `NEXT_PUBLIC_` prefix, so it stays out of the browser: route handlers, server components, server actions and `proxy`. Give it an absolute internal URL such as `http://api:8080`. The simplest setup: the browser calls the app's own route handlers, which call the backend, so no public variable is needed.

```ts
// lib/notes.ts, imported by server code only
export function notesClient() {
  const baseUrl = process.env.API_URL;

  if (baseUrl === undefined) throw new Error("Set API_URL.");

  return createClient({ baseUrl });
}

// app/api/notes/route.ts
export async function GET() {
  const reply = await notesClient().listNotes({});

  if (!reply.ok) return new Response(null, { status: reply.status });

  return Response.json(reply.body);
}
```

Route handlers run on each request. A server component on a prerendered page reads the variable at build: call `await connection()` first (or `io()` with Cache Components, Next.js 16.3 and later).

When the browser must call the backend itself, `NEXT_PUBLIC_API_URL` is fixed by `next build`. The Next.js docs say to provide runtime values from your own API; one way is to read the value in a server component and pass it down. `env` in `next.config` is a legacy build-time setting that always ships to the browser.

## Server-side rendering

A relative `baseUrl` such as `/api` works in the browser, not in Node: there is no page origin to resolve it against. Code that runs on the server needs an absolute internal URL, such as `http://api:8080`.

## Expo

Write `process.env.EXPO_PUBLIC_API_URL` exactly like this: Expo does not replace a destructured or bracketed read. A URL that changes after release needs a remote config fetched at start.

## Docker: one image for every environment

To ship one image to every environment, pick one of these two.

### Same origin behind a proxy (simplest)

The app calls `/api`, and the proxy in front of it forwards to the backend without the `/api` prefix:

```ts
const client = createClient({ baseUrl: "/api" });
```

With the official nginx image, put this in `nginx/default.conf.template`:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    location /api/ {
        proxy_pass ${API_UPSTREAM}/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri /index.html;
    }
}
```

```dockerfile
FROM nginx:stable
COPY nginx/default.conf.template /etc/nginx/templates/
COPY dist/ /usr/share/nginx/html/
```

Run it with `-e API_UPSTREAM=http://backend:3000`. At start, the image replaces `${API_UPSTREAM}` and keeps nginx's own `$host`. The trailing `/` of `proxy_pass` removes `/api`. The `X-Forwarded-*` headers give the backend the caller's address and scheme. `index.html` is revalidated on each visit, so a new deploy shows at once. ([nginx image docs](https://hub.docker.com/_/nginx))

The browser and the api share one origin, so there is no CORS to set up. Paging works too: page links are query-only (`?page=2`), so they resolve against the URL the client called, `/api` included.

In development, the Vite dev server does the same:

```ts
server: {
  proxy: {
    "/api": {
      target: "http://localhost:3000",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ""),
    },
  },
},
```

### A config file written at start

When the api lives on another origin, write a `config.json` from the environment when the container starts. Add an executable script to the image, `nginx/40-write-config.sh`:

```sh
#!/bin/sh
set -eu

cat > /usr/share/nginx/html/config.json <<JSON
{ "apiBaseUrl": "${API_BASE_URL:?set API_BASE_URL}" }
JSON
```

```dockerfile
COPY --chmod=755 nginx/40-write-config.sh /docker-entrypoint.d/
```

The image runs every executable script of `/docker-entrypoint.d/` before nginx starts, and only when the container command is `nginx`; a missing `API_BASE_URL` stops the container. Serve the file uncached, next to the `index.html` block:

```nginx
location = /config.json {
    add_header Cache-Control "no-store";
}
```

Read it once, before the app creates its client (in Angular, inside `provideAppInitializer`):

```ts
const response = await fetch("/config.json", { cache: "no-store" });
const config: { apiBaseUrl: string } = await response.json();
const client = createClient({ baseUrl: config.apiBaseUrl });
```

Anyone can read `config.json`: put only public values in it, never a secret, and write only the keys the app needs.

The template and the script write files at start. On a read-only filesystem, mount writable volumes on `/etc/nginx/conf.d` and `/usr/share/nginx/html`; to run as non-root, start from `nginxinc/nginx-unprivileged`.

Avoid replacing placeholders in the built JavaScript with `sed`: minified and hashed files and caches break it. Plugins such as `vite-envs` exist, but they are third-party.
