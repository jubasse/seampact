# 1. Install

Create the app and install seampact from your checkout.

Create the folder and the `contract` and `src` folders in it.

```sh
mkdir -p ~/src/notes-app/contract ~/src/notes-app/src
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

Build the seampact packages of your checkout into the app. Replace `~/src/seampact` with the path of your checkout.

```sh
cd ~/src/seampact && pnpm install --frozen-lockfile
node ~/src/seampact/scripts/consumers/install-into.ts ~/src/notes-app
cd ~/src/notes-app && pnpm install
```

You see `install-into: 21 packages in .../vendor/seampact`, then the install finishes.

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

Next: [2. Write the contract](2-contract.md)
