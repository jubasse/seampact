# Install

Install seampact from npm and start a project. This page is for a Node.js server. For Spring Boot, Laravel, Symfony or Python, go to [install in other ecosystems](install-other-ecosystems.md).

You need Node.js 24 or later and npm.

## Create the folder

```sh
mkdir notes-app
cd notes-app
npm init -y
npm pkg set type=module
```

## Install seampact

```sh
npm install @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

These are the packages for a NestJS server with zod validators. Another server or a client takes other generators: [the package map](../concepts/packages.md) lists them.

Keep every `@seampact/*` package at the same version.

pnpm and Yarn take the same package names. pnpm holds back a package published in the last day: if it finds none, wait or add `minimumReleaseAgeExclude: ["@seampact/*"]` to `pnpm-workspace.yaml`. Yarn Plug'n'Play is not supported.

## Start the project

```sh
npx seampact init
```

You see `Created .gitignore.` among the lines. `init` writes:

- `seampact.config.yaml`, the config;
- `contract/api.yaml`, a small example contract;
- `contract/.seampact/schemas`, the schemas your editor reads to check the contract;
- `.seampact/` in `.gitignore`.

`npx seampact init --blank` writes the api header alone instead of the example.

## From a checkout

Moved to [install in other ecosystems](install-other-ecosystems.md#from-a-checkout).

Next: [your first API](your-first-api.md)
