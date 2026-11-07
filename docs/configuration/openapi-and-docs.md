# OpenAPI and docs

Use this page to write OpenAPI documents and to add the contract to the one your framework serves. Every key is in the [Config reference](reference.md#openapi).

## Write OpenAPI documents

`seampact generate` writes one document per api, `openapi/<api>.yaml` by default. Choose another place, and add servers:

```yaml
openapi:
  notes:
    path: docs/notes.openapi.yaml
    servers:
      - { url: "https://api.example.com", description: Production }
```

`openapi: none` writes no document.

## Serve Swagger on Fastify

`nativeDocs` also puts the contract's routes in `@fastify/swagger`. The setup, with the generated `contractSwaggerTransformObject`, is in [Fastify](../backend/fastify.md#docs-and-openapi).

## Serve Swagger on NestJS

`nativeDocs` makes the generated routes visible to `@nestjs/swagger`.

```sh
npm install @nestjs/swagger@12.0.2
```

Add it to the server target, then run `npx seampact generate`.

```yaml
    artefacts:
      nativeDocs: true
```

In `src/main.ts`, add the imports and, before `app.listen`, these lines.

```ts
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as NotesNest from "./__generated__/server/notes/index.js";

const config = new DocumentBuilder().setTitle("Notes").setVersion("1").build();
const document = NotesNest.createContractDocument(app, config);

SwaggerModule.setup("docs", app, document);
```

`createContractDocument` adds the contract schemas to the document, writes OpenAPI 3.1.0 and leaves out NestJS's controller tags. It stops the app on a clash, with a message that says what to rename.

You see the Swagger page at `localhost:3000/docs`.

The boot check reads only the routes under the api's paths. When the api serves routes at the root (no prefix and no `mount`), it reads Swagger's routes too and stops the app with `framework routes are outside the contract and not allow-listed`. Then list them under `frameworkRoutes` of the server target:

```yaml
    frameworkRoutes:
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI files." }
      - { path: "/docs-json", reason: "Swagger document." }
      - { path: "/docs-yaml", reason: "Swagger document." }
```

## Serve the contract in FastAPI's docs

`nativeDocs` puts the contract's routes in FastAPI's own `/openapi.json` and `/docs`.

```yaml
    use: pypi:seampact-fastapi
    artefacts:
      nativeDocs: true
```

Run `seampact generate`. It writes `native_docs.json` beside the code, and `bind_<api>()` adds it to `app.openapi()`.

- It needs the compiler, which writes the document. Install `seampact-ir[compiler]` or the compiler binary: see [Install](../getting-started/01-install.md).
- Name the document with `document` on the entry when the api declares several. One of them must hold every operation the entry generates (`nativeDocs.document.ambiguous`, `artefacts.nativeDocs.operation-missing`: see [Generate errors](../troubleshooting/generate.md)).
- `frameworkDocs: off` removes FastAPI's own `/openapi.json`, `/docs` and `/redoc`.

Django Ninja takes `nativeDocs` the same way: `bind_<api>()` adds the routes to the document Ninja builds, at `/openapi.json` and `/docs`. `frameworkDocs: off` is refused there: build the api with `NinjaAPI(docs_url=None, openapi_url=None)` instead. See [Django Ninja](../backend/ninja.md#docs).

Django REST Framework has no `nativeDocs`. See [FastAPI](../backend/fastapi.md#docs).

## Next

- Next: [Monorepo](monorepo.md), or [Check it in CI](../features/check-in-ci.md).
- Every OpenAPI key: [Config reference](reference.md#openapi).
