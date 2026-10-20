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

`nativeDocs` makes the generated routes visible to `@nestjs/swagger`. `frameworkRoutes` lets the Swagger routes pass the boot check, which refuses routes outside the contract.

```sh
pnpm add @nestjs/swagger@12.0.2
```

Add both to the server target, then run `npx seampact generate`.

```yaml
    artefacts:
      nativeDocs: true
    frameworkRoutes:
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI files." }
      - { path: "/docs-json", reason: "Swagger document." }
      - { path: "/docs-yaml", reason: "Swagger document." }
```

In `src/main.ts`, add the import and, before `app.listen`, these lines.

```ts
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const config = NotesNest.withContractComponents({
  ...new DocumentBuilder().setTitle("Notes").setVersion("1").build(),
  openapi: "3.1.0",
});

const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false });

NotesNest.assertContractComponents(document);
SwaggerModule.setup("docs", app, document);
```

`assertContractComponents` stops the app if one of your classes has the same name as a contract schema, instead of letting it replace the schema in the document.

You see the Swagger page at `localhost:3000/docs`. Without the `frameworkRoutes` entries, the app stops at boot with `the framework route 'GET /docs/swagger-ui-init.js' is outside the contract and not allow-listed`.
