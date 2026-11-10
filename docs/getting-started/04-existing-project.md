# Add seampact to an existing app

You keep your routes. seampact takes over the ones you put in the contract, and the rest stay yours.

You need a working app on one of the supported servers, kept in a git repo to see what changes. The server-specific steps are in the section of your server (the section "Add it to your server"); the rest is the same for every stack.

The examples use a `shop` app with `GET /health`, `POST /auth/login` and a products controller.

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
seampact lint
```

You see `Linted 1 api(s): 0 error(s)`.

## Add it to your server

Open the section of your server. NestJS shows the full path with the shop app; the other servers list what differs and link their guide.

<details>
<summary>Node: NestJS</summary>

Install the packages, in the app folder.

```sh
npm install @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

The app needs NestJS 12 and `experimentalDecorators`. Your own DTOs need `emitDecoratorMetadata` too, for the class-validator `ValidationPipe`. Run the app from compiled output: `tsx` does not emit decorator metadata, so validation of your DTOs would silently do nothing.

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

**Move one controller**

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

**Wire the module and the app**

In `AppModule`, import the generated module.

```ts
imports: [ShopNest.SeampactModule.forRoot()],
```

In `main.ts`, add this line before `app.listen`. It sets up the JSON parser and the error filter of the contract routes only: your other routes keep their behaviour.

```ts
ShopNest.configureApp(app);
```

Start the app. You see it refuse to start: `2 framework routes are outside the contract`. The boot check lists your other routes, here `/auth/login` and the Swagger routes. Allow them as in "Keep your other routes" below.

</details>

<details>
<summary>Node: Express</summary>

Follow [Set up](../backend/express.md#set-up) of the Express guide to install it, then add to `seampact.config.yaml`: the three Node targets (`@seampact/codegen-ts`, `@seampact/codegen-zod`, `@seampact/codegen-express`) with `apis: [shop]`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/express.md#write-a-handler). Mount the router in your existing app, without a path, before the routes you keep ([Wire it in](../backend/express.md#wire-it-in)).

The app refuses to start while a route outside the contract is not allowed: `checkFrameworkRoutes` throws and names it. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Node: Fastify</summary>

Follow [Set up](../backend/fastify.md#set-up) of the Fastify guide to install it, then add to `seampact.config.yaml`: `@seampact/codegen-ts` and `@seampact/codegen-fastify` with `apis: [shop]`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/fastify.md#write-a-handler). Register the plugin without a prefix ([Wire it in](../backend/fastify.md#wire-it-in)).

The plugin refuses to start while a route outside the contract is not allowed. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Node: Hono</summary>

Follow [Set up](../backend/hono.md#set-up) of the Hono guide to install it, then add to `seampact.config.yaml`: `@seampact/codegen-ts`, `@seampact/codegen-zod` and `@seampact/codegen-hono` with `apis: [shop]`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/hono.md#write-a-handler). Call `registerRoutes` on your existing app ([Wire it in](../backend/hono.md#wire-it-in)).

`checkFrameworkRoutes` throws at start while a route outside the contract is not allowed. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Node: Next.js</summary>

Follow [Set up](../backend/nextjs.md#set-up) of the Next.js guide to install it, then add to `seampact.config.yaml`: `@seampact/codegen-ts`, `@seampact/codegen-zod` and `@seampact/codegen-nextjs` with `apis: [shop]`. Turn off the trailing-slash redirect in `next.config.ts`, as that section shows.

Generate, then commit the files. Implement the generated interface for the products routes: [Write a handler](../backend/nextjs.md#write-a-handler). Put the catch-all route file under the api's base path ([Wire it in](../backend/nextjs.md#wire-it-in)).

Your own pages and route files stay as they are: keep them outside the api's base path. Next.js has no boot check of routes, so `frameworkRoutes` is refused on this target.

</details>

<details>
<summary>Node: AdonisJS</summary>

Follow [Set up](../backend/adonisjs.md#set-up) of the AdonisJS guide to install it, then add to `seampact.config.yaml`: `@seampact/codegen-ts` and `@seampact/codegen-adonis` with `apis: [shop]`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/adonisjs.md#write-a-handler). Call `registerRoutes` in `start/routes.ts` outside any prefixed group ([Wire it in](../backend/adonisjs.md#wire-it-in)).

The app refuses to start while a route outside the contract is not allowed. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Java: Spring Boot</summary>

Follow [Set up](../backend/spring-boot.md#set-up) of the Spring Boot guide to install it, then add to `seampact.config.yaml`: the plugin to your build and one entry with `use: io.github.jubasse:seampact-spring-boot` and `api: shop`.

Build to generate (the build writes the files, so you do not commit them). Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/spring-boot.md#write-a-handler). Keep your `@RestController`: implement the generated interface and the mapping annotations replace yours; Spring finds the generated configuration class by component scan ([Wire it in](../backend/spring-boot.md#wire-it-in)).

The Spring context fails to start, and the build log lists every problem. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>PHP: Laravel</summary>

Follow [Set up](../backend/laravel.md#set-up) of the Laravel guide to install it, then add to `seampact.config.yaml`: `composer require seampact/laravel` and one entry with `use: seampact/laravel` and `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/laravel.md#write-a-handler). List the generated provider and call `Route::seampact('shop')` once ([Wire it in](../backend/laravel.md#wire-it-in)).

The app refuses to boot, and the message lists every problem. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>PHP: Symfony</summary>

Follow [Set up](../backend/symfony.md#set-up) of the Symfony guide to install it, then add to `seampact.config.yaml`: `composer require seampact/symfony` and one entry with `use: seampact/symfony` and `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/symfony.md#write-a-handler). List the api's bundle and import its routes ([Wire it in](../backend/symfony.md#wire-it-in)).

The app refuses to boot, and the message lists every problem. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>PHP: API Platform</summary>

Follow [Set up](../backend/api-platform.md#set-up) of the API Platform guide to install it (`composer require seampact/api-platform api-platform/symfony`), then add to `seampact.config.yaml` one entry with `use: seampact/api-platform` and `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/api-platform.md#write-a-handler). List the api's bundle and let API Platform read the generated resources ([Wire it in](../backend/api-platform.md#wire-it-in)).

The app refuses to boot, and the message lists every problem. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Python: FastAPI</summary>

Follow [Set up](../backend/fastapi.md#set-up) of the FastAPI guide to install it, then add to `seampact.config.yaml`: `use: pypi:seampact-fastapi`, `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/fastapi.md#write-a-handler). Call `bind_shop()` last in your existing app ([Wire it in](../backend/fastapi.md#wire-it-in)).

The app refuses to start: uvicorn exits with `Application startup failed. Exiting.`. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Python: Django REST Framework</summary>

Follow [Set up](../backend/drf.md#set-up) of the Django REST Framework guide to install it, then add to `seampact.config.yaml`: `use: pypi:seampact-drf`, `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/drf.md#write-a-handler). Add the boundary to `MIDDLEWARE`, the settings and the urls ([Wire it in](../backend/drf.md#wire-it-in)).

The app refuses to start: gunicorn stops with `Worker failed to boot.`, and a Django system check reports it. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

<details>
<summary>Python: Django Ninja</summary>

Follow [Set up](../backend/ninja.md#set-up) of the Django Ninja guide to install it, then add to `seampact.config.yaml`: `use: pypi:seampact-ninja`, `api: shop`.

Generate, then commit the files. Implement the generated interface in your existing controller for the products routes, and delete the DTO or request classes it replaces: [Write a handler](../backend/ninja.md#write-a-handler). Call `bind_shop()` on your `NinjaAPI` ([Wire it in](../backend/ninja.md#wire-it-in)).

The app refuses to start: gunicorn stops with `Worker failed to boot.`, and a Django system check reports it. The boot check lists your other routes: allow-list them as in "Keep your other routes" below.

</details>

## Keep your other routes

Routes of yours that are not in the contract stay as they are. The boot check lists them and refuses to start until each one is allowed. List them under `frameworkRoutes` of the server entry, then generate again. A NestJS example:

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

The shop api serves its routes at the root, so the boot check reads every route, the docs routes included. `nativeDocs` and the lines for the docs are in [OpenAPI and docs](../configuration/openapi-and-docs.md). You see your old routes working.

## Check it

```sh
seampact check
```

You see `check: the generated files and documents match the committed ones.` Run `git diff --stat` to see what the adoption touched. On Spring Boot, the build runs `check`; the other stacks type the command from [commands per stack](../features/commands-per-stack.md).

## Move the next route

Add the route to the contract, under `routes:` of the `app` surface.

```yaml
      health: { method: get, path: health, output: Health }
```

Add a `Health` schema with a `status` string. Move the handler to the generated interface. Delete the `/health` line from `frameworkRoutes`, then generate again.

You see `GET /health` served by the generated route.

## What changes for your clients

On the routes you move:

- Errors become `application/problem+json`, not your framework's default error body (for example Nest's `{ message, error, statusCode }`).
- An id typed `uuid` that is malformed answers 400, not 404.
- Query keys the contract does not declare are refused with 400.
- A list gains the optional `cursor` and `limit` query params.

Routes you did not move keep their own behaviour.

Something fails? See [troubleshooting](../troubleshooting/README.md). Every config key: [the config reference](../configuration/reference.md).

Next: [project layout](05-project-layout.md), or [check it in CI](../features/check-in-ci.md).
