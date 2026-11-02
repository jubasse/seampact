# Install

Create the app and install seampact from your checkout.

Create the folder and the `src` folder in it.

```sh
mkdir -p ~/src/notes-app/src
cd ~/src/notes-app
```

Create `package.json`.

```json
{
  "name": "notes-app",
  "private": true,
  "type": "module",
  "dependencies": {
    "@nestjs/common": "12.1.3",
    "@nestjs/core": "12.1.3",
    "@nestjs/platform-express": "12.1.3",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "24.19.1",
    "tsx": "4.23.15",
    "typescript": "6.0.3"
  }
}
```

Not on NestJS? Your handlers page lists the dependencies to use instead.

Build the seampact packages of your checkout into the app. Replace `~/src/seampact` with the path of your checkout.

```sh
cd ~/src/seampact && pnpm install --frozen-lockfile
node ~/src/seampact/scripts/consumers/install-into.ts ~/src/notes-app
cd ~/src/notes-app && pnpm install
```

You see `install-into: 32 packages and packs in .../vendor/seampact`, then pnpm installs them.

Start the project.

```sh
npx seampact init
```

`init` writes `seampact.config.yaml`, a small example contract in `contract/api.yaml`, the editor schemas in `contract/.seampact/schemas`, and `.seampact/` in `.gitignore`. You see `Created .gitignore.` among its lines. `npx seampact init --blank` writes the api header alone instead of the example.

Create `tsconfig.json`. NestJS decorators need `experimentalDecorators`.

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "experimentalDecorators": true
  },
  "include": ["src"]
}
```

## On Python

Python 3.12 or later, and a FastAPI or Django REST Framework app. The Python `seampact` command has `generate` and `check` only, and reads a pinned bundle of the contract. So you write the contract as in the next pages, and pack it with `npx seampact bundle` (see [Sharing a contract](../features/sharing-contracts.md)).

Install seampact from your checkout with `uv build` and `pip`, set `use: pypi:seampact-fastapi` or `use: pypi:seampact-drf` in `seampact.config.yaml`, then run `seampact generate`. The steps are in the guide of your framework: [FastAPI](../backend/fastapi.md#set-up) or [Django REST Framework](../backend/drf.md#set-up).

Next: [write the contract](02-first-contract.md)
