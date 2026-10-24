# Point the client at your backend

The backend URL is the `baseUrl` you pass to `createClient`. seampact never writes it into the generated code: read it from an environment variable, so each environment gets its own.

Create each client once, when the app starts, and reuse it. Two apis on two backends: two variables, two clients.

## Vite

```ts
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
```

Put `VITE_API_URL=http://localhost:3000` in `.env.development`. Only `VITE_` variables reach the browser.

Vite writes the value into the bundle at build time. To change it without a rebuild, see [Docker](#docker-one-image-for-every-environment). ([Vite docs](https://vite.dev/guide/env-and-mode))

## Next.js

In a client component, `process.env.NEXT_PUBLIC_API_URL` works, but `next build` fixes its value.

For one build in every environment, read the URL on the server and pass it down:

```tsx
import { connection } from "next/server";

export default async function Page() {
  await connection();

  return <Notes apiUrl={process.env.API_URL} />;
}
```

`await connection()` makes Next.js read `API_URL` on each request, not once at build. The `Notes` client component creates its client from `apiUrl`. ([Next.js docs](https://nextjs.org/docs/app/guides/environment-variables))

## Expo

```ts
const baseUrl = process.env.EXPO_PUBLIC_API_URL;

if (baseUrl === undefined) throw new Error("Set EXPO_PUBLIC_API_URL.");

const client = createClient({ baseUrl });
```

Write `process.env.EXPO_PUBLIC_API_URL` exactly like this: Expo does not replace a destructured or bracketed read. The value is fixed when the app is bundled; a URL that changes after release needs a remote config fetched at start. ([Expo docs](https://docs.expo.dev/guides/environment-variables/))

## Node

A server calling another api reads the variable at runtime:

```ts
const baseUrl = process.env.NOTES_API_URL;

if (baseUrl === undefined) throw new Error("Set NOTES_API_URL.");

const notes = createClient({ baseUrl });
```

## Docker: one image for every environment

A Vite, Next.js public or Expo variable is fixed at build. To ship one image to every environment, pick one of these two.

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

Run it with `-e API_UPSTREAM=http://backend:3000`. At start, the image replaces `${API_UPSTREAM}` and keeps nginx's own `$host`. The trailing `/` of `proxy_pass` removes `/api`. The `X-Forwarded-*` headers give the backend the caller's address and scheme. ([nginx image docs](https://hub.docker.com/_/nginx))

The browser and the api share one origin, so there is no CORS to set up. Paging works too: the backend's `Link` header holds its own paths, without `/api`, and the client reads only the cursor from them.

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

The image runs every executable script of `/docker-entrypoint.d/` before nginx starts; a missing `API_BASE_URL` stops the container. Serve the file uncached, next to the `index.html` block:

```nginx
location = /config.json {
    add_header Cache-Control "no-store";
}
```

Read it once, before the app creates its client:

```ts
const response = await fetch("/config.json", { cache: "no-store" });
const config: { apiBaseUrl: string } = await response.json();
const client = createClient({ baseUrl: config.apiBaseUrl });
```

Anyone can read `config.json`: put only public values in it, never a secret, and write only the keys the app needs.

Avoid replacing placeholders in the built JavaScript with `sed`: minified and hashed files and caches break it. Plugins such as `vite-envs` exist, but they are third-party.
