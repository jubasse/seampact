# Add seampact to an existing NestJS app

You keep your routes. seampact takes over the ones you put in the contract, and the rest stay yours.

You need Node.js 24 or later, pnpm, and a NestJS 12 app that compiles with `experimentalDecorators` and `emitDecoratorMetadata` (the class-validator `ValidationPipe` needs the second one). Run the app from compiled output: `tsx` does not emit decorator metadata, so validation would silently do nothing. Keep the app in a git repo, to see what changes.

The examples use a `shop` app with `GET /health`, `POST /auth/login` and a products controller.

## Install

Run this in the app folder. Replace `~/src/seampact` with the path of your checkout.

```sh
node ~/src/seampact/scripts/consumers/install-into.ts .
pnpm install
```

You see `install-into: 21 packages in .../vendor/seampact`. `package.json`, `pnpm-workspace.yaml` and `.gitignore` changed: check the diff.

## Describe the routes you move

Start with the products routes. Copy the schemas from your DTOs. Create `contract/api.yaml`.

```yaml
api:
  name: shop
  version: 1
  kind: product
  maturity: provisional
  summary: The shop api.

schemas:
  ProductId: { type: string, format: uuid }
  Product:
    type: object
    required: [id, name, priceCents]
    properties:
      id: ProductId
      name: { type: string, minLength: 1, maxLength: 100 }
      priceCents: { type: integer, minimum: 0 }
  CreateProduct:
    type: object
    required: [name, priceCents]
    properties:
      name: { type: string, minLength: 1, maxLength: 100 }
      priceCents: { type: integer, minimum: 0 }

surfaces:
  app:
    prefix: ""
    pathVersion: none
    access: { public: "Anyone may call the catalogue." }
    routes:
      products:
        kind: collection
        singular: product
        id: { id: ProductId }
        item: Product
        ops:
          list: { paging: none }
          get: {}
          create: { input: CreateProduct }
```

- `pathVersion: none` and `prefix: ""` keep your paths: `/products`, not `/v1/products`.
- `singular: product` names the operations `getProduct` and `createProduct`. Without it, an id param named `id` gives `getId`.
- `paging: none` keeps the list a bare array, as your clients expect.

```sh
npx seampact lint
```

You see `Linted 1 api(s): 0 error(s)`.

## Generate with your validator

Create `seampact.config.yaml`. This one keeps class-validator; `@seampact/codegen-zod` and `@seampact/codegen-yup` work too.

```yaml
outDir: src/__generated__
sources:
  shop:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [shop]
  - id: validators
    use: "@seampact/codegen-class-validator"
    apis: [shop]
  - id: server
    use: "@seampact/codegen-nestjs"
    apis: [shop]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

```sh
npx seampact generate
```

You see one line per target, and the files in `src/__generated__` and `openapi/shop.yaml`. Commit them.

## Move one controller

Delete the DTO classes: the generated class-validator classes replace them. Implement the generated interface and swap the route decorators.

```ts
import { Controller } from "@nestjs/common";
import * as ShopNest from "../__generated__/server/shop/index.js";
import * as Shop from "../__generated__/types/shop/index.js";

@Controller()
export class ProductsController implements ShopNest.ProductsEndpoints {
  @ShopNest.getProduct()
  getProduct(@ShopNest.getProduct.input() input: Shop.GetProductInput) {
    const product = products.get(input.path.id);

    if (product === undefined) return { status: Shop.Status.NotFound, code: Shop.ErrorCode.ApiNotFound };

    return { status: Shop.Status.Ok, body: product };
  }
}
```

A list handler returns the array: `{ status: Shop.Status.Ok, body: [...products.values()] }`.

Controllers for routes outside the contract stay as they are.

```sh
npx tsc -p .
```

You see no output.

## Wire the module and the app

In `AppModule`, import the generated module.

```ts
imports: [ShopNest.SeampactModule.forRoot()],
```

In `main.ts`, add these lines before `app.listen`. `preRoutingFilter` only acts on contract paths.

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: ShopNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(ShopNest.preRoutingFilter);
```

Start the app. You see it refuse to start: `2 framework routes are outside the contract`. The boot check lists your other routes, here `/auth/login` and the Swagger routes.

## Keep your other routes

List them under `frameworkRoutes` of the `server` target, then run `npx seampact generate`.

```yaml
    artefacts:
      nativeDocs: true
    frameworkRoutes:
      - { path: "/health", reason: "Health check, not in the contract yet." }
      - { path: "/auth/login", reason: "Login, not part of the shop contract." }
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI files." }
      - { path: "/docs-json", reason: "Swagger document." }
      - { path: "/docs-yaml", reason: "Swagger document." }
```

`nativeDocs` and the `main.ts` lines for Swagger are in [OpenAPI and docs](../configuration/openapi-and-docs.md). You see `/docs` and your old routes working, and `/docs-json` listing both.

## Check it

```sh
npx seampact check
```

You see `check: the generated files and documents match the committed ones.` Run `git diff --stat` to see what the adoption touched outside `src/__generated__`.

## Move the next route

Add the route to the contract, under `routes:` of the `app` surface.

```yaml
      health: { method: get, path: health, output: Health }
```

Add a `Health` schema with a `status` string. Move the handler: `implements ShopNest.AppEndpoints` and `@ShopNest.health()`. Delete the `/health` line from `frameworkRoutes`, then run `npx seampact generate`.

You see `GET /health` served by the generated route.

## What changes for your clients

On the routes you move:

- Errors become `application/problem+json`, not Nest's `{ message, error, statusCode }`.
- An id typed `uuid` that is malformed answers 400, not 404.
- Query keys the contract does not declare are refused with 400.
- A list gains the optional `cursor` and `limit` query params.

Routes you did not move keep their own behaviour.

Something fails? See [troubleshooting](../troubleshooting/README.md). Every config key: [the config file](../configuration/config-file.md).
