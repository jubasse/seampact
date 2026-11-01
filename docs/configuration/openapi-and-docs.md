# OpenAPI and docs

Write OpenAPI documents, and complete the one your framework serves.

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

## Serve Swagger on NestJS

`nativeDocs` makes the generated routes visible to `@nestjs/swagger`.

```sh
pnpm add @nestjs/swagger@12.0.2
```

Add it to the server target, then run `npx seampact generate`.

```yaml
    artefacts:
      nativeDocs: true
```

In `src/main.ts`, add the import and, before `app.listen`, these lines.

```ts
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const config = new DocumentBuilder().setTitle("Notes").setVersion("1").build();
const document = NotesNest.createContractDocument(app, config);

SwaggerModule.setup("docs", app, document);
```

`createContractDocument` adds the contract schemas to the document, writes OpenAPI 3.1.0 and leaves out NestJS's controller tags. It stops the app if one of your classes has the same name as a contract schema, instead of letting it replace the schema in the document. It also stops it if you set another OpenAPI version or `autoTagControllers: true`.

You see the Swagger page at `localhost:3000/docs`.

The boot check reads only the routes under the api's paths. When the api serves routes at the root (no prefix and no `mount`), it reads Swagger's routes too and stops the app with `framework routes are outside the contract and not allow-listed`. Then list them under `frameworkRoutes` of the server target:

```yaml
    frameworkRoutes:
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI files." }
      - { path: "/docs-json", reason: "Swagger document." }
      - { path: "/docs-yaml", reason: "Swagger document." }
```
